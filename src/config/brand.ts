/**
 * Application identity. The MZ Marketing mark supplied by the owner (18 Nov 2026): white "MZ" with the
 * gold bird. `logo` is for dark backgrounds (the sidebar); `logoOnLight` has charcoal letters for white
 * backgrounds (sign-in page, printed receipt, sales order, booking form, proposal). The browser-tab icon
 * is the same mark on black (src/app/icon.png, apple-icon.png).
 */
export const brand = {
  name: "MZ MARKETING",
  monogram: "MZ",
  productLabel: "MZ MARKETING CRM",
  tagline: "Real Estate CRM",
  displayName: "MZ Marketing",
  slogan: "Your Project Partner",
  /** Contact line printed at the foot of the booking form (from the client's template, 18 Nov 2026). */
  contact: { address: "Main Boulevard, Park Avenue Housing Society, Lahore", web: "www.mzmarketing.pk", email: "info@mzmarketing.pk", phone: "+92 311 1110008" },
  logo: { src: "/brand/mz-mark.png", width: 480, height: 365, alt: "MZ Marketing" },
  logoOnLight: { src: "/brand/mz-mark-on-light.png", width: 480, height: 365, alt: "MZ Marketing" },
} as const;
