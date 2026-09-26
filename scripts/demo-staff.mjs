/**
 * The nine invented clinicians a retired version of database/fatclinic.sql
 * seeded into public.users.
 *
 * Kept in its own file because two scripts need it and they must not disagree:
 * remove-demo-staff.mjs deletes these rows, and apply-schema.mjs fails if they
 * ever come back. A second copy of the list would let one script's idea of
 * "demo" drift from the other's, which is exactly the kind of quiet
 * disagreement that ends with invented names in a real audit trail.
 *
 * This is a list, not a pattern, on purpose. A `like '%@fatclinic.health'` would
 * also match a real clinician who was given a company address, and a cleanup
 * that can delete a real person's account is worse than no cleanup.
 */
export const DEMO_STAFF_EMAILS = Object.freeze([
  'adeleke@fatclinic.health',
  'alabi@fatclinic.health',
  'ngozi@fatclinic.health',
  'ibrahim@fatclinic.health',
  'kemi@fatclinic.health',
  'tayo@fatclinic.health',
  'emeka@fatclinic.health',
  'chinedu.rad@fatclinic.health',
  'amina.pt@fatclinic.health',
]);
