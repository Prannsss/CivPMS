"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BarChart3, HardHat, ClipboardCheck, List, Mail, Network, Search } from "lucide-react";
import { PASSWORD_MIN_LENGTH, type ProjectColorKey } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { Form, FormError, FormField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ChoiceCard, RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Demo, Section } from "./section";

const projectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Project name needs at least 3 characters.")
      .max(120, "Keep the project name under 120 characters."),
    budget: z
      .number({ error: "Enter the estimated budget in pesos." })
      .positive("Budget must be more than ₱0."),
    start: z.string().min(1, "Pick the estimated start date."),
    end: z.string().min(1, "Pick the estimated end date."),
    site: z.string().optional(),
  })
  .refine((v) => !v.start || !v.end || v.end >= v.start, {
    path: ["end"],
    message: "End date must be on or after the start date.",
  });

type ProjectForm = z.infer<typeof projectSchema>;

function ProjectFormDemo() {
  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    mode: "onTouched",
    defaultValues: { name: "", budget: undefined, start: "", end: "", site: "" },
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const startDate = useWatch({ control: form.control, name: "start" });

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={form.handleSubmit(async (values) => {
          setServerError(null);
          await new Promise((r) => setTimeout(r, 900));
          if (values.name.toLowerCase().includes("taken")) {
            setServerError("A project with this name already exists in your company. Choose another name.");
            return;
          }
          toast.success("Project created", { description: values.name });
        })}
      >
        <FormError>{serverError}</FormError>
        <FormField
          control={form.control}
          name="name"
          label="Project name"
          required
          hint="3–120 characters, unique within your company."
          render={({ field }) => <Input placeholder="e.g. Cebu Coastal Road Widening" {...field} />}
        />
        <FormField
          control={form.control}
          name="budget"
          label="Estimated budget"
          required
          render={({ field }) => (
            <CurrencyInput
              name={field.name}
              ref={field.ref}
              value={field.value}
              onBlur={field.onBlur}
              onValueChange={(v) => field.onChange(v ?? undefined)}
              placeholder="0.00"
            />
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="start"
            label="Estimated start"
            required
            render={({ field }) => (
              <DateInput name={field.name} ref={field.ref} value={field.value} onBlur={field.onBlur} onValueChange={field.onChange} />
            )}
          />
          <FormField
            control={form.control}
            name="end"
            label="Estimated end"
            required
            render={({ field }) => (
              <DateInput
                name={field.name}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onValueChange={field.onChange}
                min={startDate || undefined}
              />
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="site"
          label="Site / location"
          hint="Shown to viewers of the shared calendar."
          render={({ field }) => <Input placeholder="e.g. Talisay, Cebu" {...field} value={field.value ?? ""} />}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => form.reset()}>
            Reset
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Create project
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          Tip: submit empty to see inline errors; use a name containing “taken” to see a server error.
        </p>
      </form>
    </Form>
  );
}

export function FormsSection() {
  const [role, setRole] = useState("pm");
  const [unit, setUnit] = useState<"hours" | "days">("days");
  const [view, setView] = useState<"graph" | "list">("graph");
  const [color, setColor] = useState<ProjectColorKey>("blue");
  const [budget, setBudget] = useState<number | null>(1250000);
  const [date, setDate] = useState("2026-10-12");
  const [weight, setWeight] = useState("cost");
  const [notify, setNotify] = useState(true);

  return (
    <Section
      id="forms"
      title="Forms"
      description="Wrap every control in <Field>: label, hint and error are wired with aria-describedby / aria-invalid. Validate on blur and on submit; errors say what's wrong and how to fix it."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Text inputs">
          <div className="grid gap-5">
            <Field label="Email" hint="Use your work or personal email." required>
              <Input type="email" placeholder="you@company.ph" leading={<Mail />} autoComplete="email" />
            </Field>
            <Field label="Password" error={`Use at least ${PASSWORD_MIN_LENGTH} characters.`}>
              <PasswordInput defaultValue="short" autoComplete="new-password" />
            </Field>
            <Field label="Search">
              <Input type="search" placeholder="Search activities" leading={<Search />} />
            </Field>
            <Field label="Company" hint="Locked after onboarding." disabled>
              <Input defaultValue="Dela Cruz Builders" />
            </Field>
            <Field label="Description">
              <Textarea placeholder="Scope, access notes, contacts…" rows={3} />
            </Field>
          </div>
        </Demo>
        <Demo title="Create project (react-hook-form + zod)">
          <ProjectFormDemo />
        </Demo>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Demo title="Pickers">
          <div className="grid gap-5">
            <Field label="Weighting" hint="How activities contribute to overall progress.">
              <Select value={weight} onValueChange={setWeight}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Weight by</SelectLabel>
                    <SelectItem value="cost">Estimated cost</SelectItem>
                    <SelectItem value="hours">Working hours</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Calendar template" error="Pick a working calendar.">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mf8">Mon–Fri, 8 h/day</SelectItem>
                  <SelectItem value="ms8">Mon–Sat, 8 h/day</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Estimated cost" hint={budget === null ? "Empty" : `Emits ${budget}`}>
                <CurrencyInput value={budget} onValueChange={setBudget} />
              </Field>
              <Field label="Start date">
                <DateInput value={date} onValueChange={setDate} min="2026-01-01" max="2027-12-31" />
              </Field>
            </div>
            <Field label="Project color">
              <ColorSwatchPicker value={color} onValueChange={setColor} />
            </Field>
          </div>
        </Demo>
        <Demo title="Choices">
          <div className="grid gap-6">
            <div className="flex flex-col gap-3">
              <Checkbox label="Include Philippine holidays" description="Regular and special non-working days." defaultChecked />
              <Checkbox label="Carry values to the new child" checked="indeterminate" />
              <Checkbox label="Disabled option" disabled />
            </div>
            <Switch
              label="Email digest"
              description="One summary email per day instead of one per event."
              checked={notify}
              onCheckedChange={setNotify}
            />
            <Field label="Duration display">
              <RadioGroup defaultValue="days" className="flex gap-6">
                <RadioGroupItem value="hours" label="Hours" />
                <RadioGroupItem value="days" label="Days" />
              </RadioGroup>
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                aria-label="Duration unit"
                value={unit}
                onValueChange={setUnit}
                options={[
                  { value: "hours", label: "Hours" },
                  { value: "days", label: "Days" },
                ]}
              />
              <SegmentedControl
                aria-label="WBS view"
                value={view}
                onValueChange={setView}
                options={[
                  { value: "graph", label: "Graph", icon: <Network /> },
                  { value: "list", label: "List", icon: <List /> },
                ]}
              />
              <SegmentedControl
                aria-label="Chart type"
                size="sm"
                value="bar"
                onValueChange={() => {}}
                options={[{ value: "bar", label: "Bar chart", icon: <BarChart3 />, iconOnly: true }]}
              />
              <ThemeToggle variant="segmented" />
            </div>
          </div>
        </Demo>
      </div>

      <Demo title="Choice cards" description="Onboarding role picker (mockup 5). Arrow keys move between cards.">
        <RadioGroup value={role} onValueChange={setRole} aria-label="Your role" className="grid gap-3 md:grid-cols-2">
          <ChoiceCard
            value="pm"
            icon={<HardHat />}
            title="Project Manager"
            description="Plan projects, set budgets and schedules, invite your team and approve inspections."
          />
          <ChoiceCard
            value="inspector"
            icon={<ClipboardCheck />}
            title="Inspector / QA / QC"
            description="Update progress from the site and propose inspections. You'll need an invite code."
          />
        </RadioGroup>
      </Demo>
    </Section>
  );
}
