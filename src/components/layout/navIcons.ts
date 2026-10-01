/**
 * Menu icon names, resolved.
 *
 * `navModel.ts` stores icons as strings so that the menu stays plain data and can
 * be imported by the self-test without dragging React in. This is the one place
 * where a name becomes a component.
 *
 * A missing name resolves to `CircleHelp` rather than throwing, so a typo shows a
 * question mark and is obvious on screen. But `MISSING_ICON_NAMES` is exported so
 * the self-test can fail the build on an unknown name - a question mark in the
 * menu is a visible bug, and a build failure is a better one.
 */
import {
  LayoutDashboard, Users, Stethoscope, FlaskConical, Pill, Bot, Settings, Radio, Activity,
  UserPlus, Clock, BookOpen, TestTube, Bug, Dna, Microscope, FileCheck2, Inbox, Package,
  Receipt, CreditCard, Coins, TrendingUp, PieChart, DollarSign, Sparkles, ShieldCheck, UserCog,
  Sliders, Building, Globe, Boxes, FileSpreadsheet, BarChart3, UserCheck, Bell, LayoutGrid,
  CheckCircle2, CircleHelp, type LucideIcon,
} from 'lucide-react';

export const NAV_ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, Stethoscope, FlaskConical, Pill, Bot, Settings, Radio, Activity,
  UserPlus, Clock, BookOpen, TestTube, Bug, Dna, Microscope, FileCheck2, Inbox, Package,
  Receipt, CreditCard, Coins, TrendingUp, PieChart, DollarSign, Sparkles, ShieldCheck, UserCog,
  Sliders, Building, Globe, Boxes, FileSpreadsheet, BarChart3, UserCheck, Bell, LayoutGrid,
  CheckCircle2,
};

/** The component for an icon name, or a visible placeholder if the name is wrong. */
export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? CircleHelp;
}

/** Icon names the menu asks for that this file cannot supply. Should be empty. */
export function MISSING_ICON_NAMES(names: string[]): string[] {
  return [...new Set(names)].filter(n => !(n in NAV_ICONS));
}
