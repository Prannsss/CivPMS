"use client";

import { useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toaster";
import { formatDuration } from "@/lib/domain/format";
import { setDurationUnit } from "@/server/actions/profile";
import { SettingsCard, SettingsRow } from "./settings-layout";

type Unit = "hours" | "days";

const UNIT_OPTIONS = [
  { value: "hours", label: "Hours", icon: <Clock /> },
  { value: "days", label: "Days", icon: <CalendarDays /> },
] as const;

/** Duration display unit (saved to the profile) and theme (saved in this browser). */
export function DisplaySection({ initialUnit }: { initialUnit: Unit }) {
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [saving, setSaving] = useState(false);

  async function changeUnit(next: Unit) {
    const previous = unit;
    setUnit(next);
    setSaving(true);
    const result = await setDurationUnit({ durationUnit: next });
    setSaving(false);
    if (!result.ok) {
      setUnit(previous);
      toast.error("Couldn't change the duration unit", { description: result.error.message });
      return;
    }
    toast.success(next === "days" ? "Durations now show in days" : "Durations now show in hours");
  }

  return (
    <SettingsCard id="display" title="Display" description="How CivPMS looks and shows numbers for you.">
      <div className="flex flex-col gap-5">
        <SettingsRow
          labelId="duration-unit-label"
          label="Show durations in"
          hint={
            <>
              Durations are stored in working hours. Example: {formatDuration(12, unit, 8)} at 8 hours a day.
            </>
          }
        >
          <SegmentedControl
            aria-label="Show durations in"
            options={UNIT_OPTIONS}
            value={unit}
            onValueChange={(value) => void changeUnit(value)}
            disabled={saving}
          />
        </SettingsRow>
        <Separator />
        <SettingsRow label="Theme" hint="Saved on this device. System follows your phone or computer setting.">
          <ThemeToggle variant="segmented" />
        </SettingsRow>
      </div>
    </SettingsCard>
  );
}
