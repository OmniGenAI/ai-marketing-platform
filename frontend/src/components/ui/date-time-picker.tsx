"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DateTimePickerProps {
  /** ISO string value e.g. "2026-05-11T14:30" */
  value: string
  onChange: (value: string) => void
  /** Minimum selectable date — defaults to now */
  min?: Date
  placeholder?: string
  className?: string
}

export function DateTimePicker({
  value,
  onChange,
  min = new Date(),
  placeholder = "Pick date & time",
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse current value — guard against invalid date strings so we never
  // hand `format()` an Invalid Date (which throws RangeError).
  const selected = React.useMemo(() => {
    if (!value) return undefined
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  }, [value])
  const timeStr = selected
    ? `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`
    : "12:00"

  const handleDateSelect = (day: Date | undefined) => {
    if (!day) return
    // Preserve the current time when changing date
    const [h, m] = timeStr.split(":").map(Number)
    day.setHours(h, m, 0, 0)
    onChange(formatForInput(day))
    setOpen(false)
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(":").map(Number)
    const base = selected ?? new Date()
    base.setHours(h, m, 0, 0)
    onChange(formatForInput(base))
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
  }

  return (
    <div className={cn("flex gap-2 items-center", className)}>
      {/* Date popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "flex-1 justify-start text-left font-normal gap-2",
              !selected && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0" />
            {selected ? format(selected, "d MMM yyyy") : <span>{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleDateSelect}
            disabled={(day) => day < new Date(min.getFullYear(), min.getMonth(), min.getDate())}
          />
        </PopoverContent>
      </Popover>

      {/* Time input — only visible when a date is selected */}
      {selected && (
        <input
          type="time"
          value={timeStr}
          onChange={handleTimeChange}
          className="rounded-md border bg-background px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-ring appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
        />
      )}

      {/* Clear */}
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={handleClear}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function formatForInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
