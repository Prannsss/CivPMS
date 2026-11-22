/** Project Settings sections (`?section=`). Plain module: the server page reads it too. */
export const PROJECT_SETTINGS_SECTIONS = ["details", "status", "danger"] as const;
export type ProjectSettingsSectionId = (typeof PROJECT_SETTINGS_SECTIONS)[number];

export function isProjectSettingsSection(value: unknown): value is ProjectSettingsSectionId {
  return typeof value === "string" && (PROJECT_SETTINGS_SECTIONS as readonly string[]).includes(value);
}
