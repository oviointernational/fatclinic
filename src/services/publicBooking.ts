/**
 * Public appointment booking - the landing page's visitor-facing counterpart to
 * db.createOnlineBooking().
 *
 * Staff bookings (the header "Book Appointment" modal) go through db + sync,
 * which is fine because the front-desk officer is signed in. A *visitor* has no
 * session, so their form cannot touch the tables: every table has FORCE ROW
 * LEVEL SECURITY and the anon role holds no grants. The one exception is the
 * RPC app_submit_online_booking, a SECURITY DEFINER function that validates the
 * input in the database, inserts exactly one online_bookings row, and returns
 * it. That is the only channel this module uses, so the visitor never sees a
 * refused write and never gets a badge (there is no sync queue here at all).
 *
 * See scripts/check-public-booking.mjs for the live proof that anon can submit
 * a booking and cannot read, write or reach anything else.
 */
import { OnlineBooking } from '../types';
import { requireSupabase } from './supabase';

/** Everything a visitor can truthfully type about themselves on the booking form. */
export interface BookingDraft {
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  phone: string;
  email?: string;
  address: string;
  reason: string;
  preferredDate: string;
  preferredTime: string;
}

export type SubmitBookingResult =
  | { ok: true; booking: OnlineBooking }
  | { ok: false; message: string };

/** PostgREST returns the created row as a single-element array for a RETURNS TABLE RPC. */
interface BookingRow {
  id: string;
  patient_code: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  dob: string;
  age: number;
  sex: string;
  phone: string;
  email: string | null;
  address: string;
  reason_for_appointment: string;
  preferred_date: string;
  preferred_time: string;
  booked_at: string;
  status: string;
}

function toBooking(r: BookingRow): OnlineBooking {
  return {
    id: r.id,
    patientCode: r.patient_code,
    firstName: r.first_name,
    middleName: r.middle_name ?? undefined,
    lastName: r.last_name,
    dob: r.dob,
    age: r.age,
    sex: r.sex as OnlineBooking['sex'],
    phone: r.phone,
    email: r.email ?? undefined,
    address: r.address,
    reasonForAppointment: r.reason_for_appointment,
    preferredDate: r.preferred_date,
    preferredTime: r.preferred_time,
    bookedAt: r.booked_at,
    status: r.status as OnlineBooking['status'],
  };
}

export async function submitOnlineBooking(draft: BookingDraft): Promise<SubmitBookingResult> {
  let supabase;
  try {
    supabase = requireSupabase();
  } catch {
    return {
      ok: false,
      message: 'This site is not connected to its booking service right now. Please call the clinic instead.',
    };
  }

  let data: unknown;
let error: { message: string } | null = null;
try {
  const res = await supabase.rpc('app_submit_online_booking', {
    p_first_name: draft.firstName,
    p_middle_name: draft.middleName ?? null,
    p_last_name: draft.lastName,
    p_dob: draft.dob,
    p_age: draft.age,
    p_sex: draft.sex,
    p_phone: draft.phone,
    p_email: draft.email ?? null,
    p_address: draft.address,
    p_reason: draft.reason,
    p_preferred_date: draft.preferredDate,
    p_preferred_time: draft.preferredTime,
  });
  data = res.data;
  error = res.error ?? null;
} catch (err) {
  // A thrown rpc() means the request itself never came back - a dropped
  // connection, a dead network, a blocked fetch. There is no PostgREST
  // message to show when that happens (that is what `error` is for), so the
  // visitor gets the same "call us" sentence instead of a silent nothing.
  console.error('[public-booking] request failed:', err);
  return {
    ok: false,
    message: 'The booking service could not be reached. Please check your connection and try again.',
  };
}

  if (error) {
    // The RPC refuses with a plain sentence ("that phone number already has a
    // pending appointment on this date"), which is exactly the message to show.
    return { ok: false, message: error.message };
  }

  const row = Array.isArray(data) && data.length > 0 ? (data[0] as BookingRow) : null;
  if (!row || !row.patient_code) {
    return { ok: false, message: 'The appointment could not be confirmed. Please try again.' };
  }

  return { ok: true, booking: toBooking(row) };
}