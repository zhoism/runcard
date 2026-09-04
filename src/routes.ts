/** Top-level destinations are deliberately distinct: the bare URL is the landing page, while #/ is the project index. */
export const NAV_HREF = {
  landing: import.meta.env.BASE_URL,
  projects: "#/",
  compare: "#/compare",
} as const;
