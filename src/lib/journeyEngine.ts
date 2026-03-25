import {
  MacroEvent,
  MacroNumber,
  Journey,
  JourneyCalculation,
  VehicleStatus,
  TimelineSegment,
  DAILY_MACRO_LIMITS,
} from "@/types/journey";

// Generate unique ID
export function generateId(): string {
  return crypto.randomUUID();
}

// Format date to YYYY-MM-DD
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Format minutes to HH:MM
export function formatMinutes(mins: number): string {
  if (mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Diff in minutes between two dates
function diffMinutes(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60000;
}

// Convert Date to minutes since midnight
function toMinuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Build journeys from a sorted list of macro events for one vehicle.
 * A journey starts with macro 1 and ends with macro 2.
 * All macros between belong to the same journey.
 */
export function buildJourneys(events: MacroEvent[]): Journey[] {
  // Deduplicate by id, then by same vehicle+macro+timestamp
  const seenIds = new Set<string>();
  const keyMap = new Map<string, number>(); // key -> index in unique[]
  const unique: MacroEvent[] = [];
  const hasAddress = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length > 0;

  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const evt of sorted) {
    if (seenIds.has(evt.id)) continue;
    seenIds.add(evt.id);

    // Dedup by vehicle + macro + timestamp ONLY — same physical event may have
    // different journeyId/dataJornada in the DB; collapsing prevents fragmentation.
    const key = `${evt.vehicleId}_${evt.macroNumber}_${evt.createdAt.getTime()}`;
    if (keyMap.has(key)) {
      // If existing one has no endereco but this one does, replace it
      const existingIdx = keyMap.get(key)!;
      if (!hasAddress(unique[existingIdx].endereco) && hasAddress(evt.endereco)) {
        unique[existingIdx] = evt;
      }
      continue;
    }
    keyMap.set(key, unique.length);
    unique.push(evt);
  }

  // Try to group by journeyId from database first
  const hasJourneyIds = unique.some(e => e.journeyId);

  if (hasJourneyIds) {
    // Group events by journeyId
    const journeyGroups = new Map<string, MacroEvent[]>();
    const ungrouped: MacroEvent[] = [];

    for (const evt of unique) {
      if (evt.journeyId) {
        if (!journeyGroups.has(evt.journeyId)) {
          journeyGroups.set(evt.journeyId, []);
        }
        journeyGroups.get(evt.journeyId)!.push(evt);
      } else {
        ungrouped.push(evt);
      }
    }

    const journeys: Journey[] = [];

    for (const [jId, groupEvents] of journeyGroups) {
      const sortedGroup = groupEvents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const macro1 = sortedGroup.find((e) => e.macroNumber === 1);
      const macrosFromStart = macro1
        ? sortedGroup.filter((e) => e.createdAt.getTime() >= macro1.createdAt.getTime())
        : sortedGroup;
      const macro2 = macro1
        ? macrosFromStart.find((e) => e.macroNumber === 2 && e.createdAt.getTime() >= macro1.createdAt.getTime())
        : macrosFromStart.find((e) => e.macroNumber === 2);

      // Extract date from journeyId (format: vehicleId-YYYY-MM-DD) or from dataJornada
      const dateFromJourneyId = jId.match(/(\d{4}-\d{2}-\d{2})$/)?.[1];
      const dateFromEvent = sortedGroup[0].dataJornada;
      const journeyDate = dateFromJourneyId || dateFromEvent || toDateKey(sortedGroup[0].createdAt);

      journeys.push({
        id: jId,
        vehicleId: sortedGroup[0].vehicleId,
        driverId: sortedGroup[0].driverId || "unknown",
        driverName: sortedGroup[0].driverName || null,
        startTime: macro1?.createdAt || macrosFromStart[0].createdAt,
        endTime: macro2?.createdAt || null,
        macros: macrosFromStart,
        date: journeyDate,
      });
    }

    // Post-process: merge orphan macro 2 journeys into previous open journeys.
    // This handles cross-day scenarios where macro 1 is on day X (journeyId-X)
    // and macro 2 is on day X+1 (journeyId-X+1).
    const sortedJourneys = journeys.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const mergedJourneys: Journey[] = [];
    const consumed = new Set<string>();

    for (const j of sortedJourneys) {
      if (consumed.has(j.id)) continue;

      const hasMacro1 = j.macros.some(m => m.macroNumber === 1);
      const hasMacro2 = j.macros.some(m => m.macroNumber === 2);

      if (hasMacro1 && !hasMacro2) {
        // Open journey — look for the next orphan macro 2 from same vehicle,
        // but only within a safe window (same/next day) and before another macro 1.
        const nextJourneyWithMacro1 = sortedJourneys.find(
          nj => !consumed.has(nj.id) && nj.id !== j.id &&
            nj.vehicleId === j.vehicleId &&
            nj.startTime.getTime() > j.startTime.getTime() &&
            nj.macros.some(m => m.macroNumber === 1)
        );

        const maxOrphanTime = Math.min(
          j.startTime.getTime() + 24 * 60 * 60000,
          nextJourneyWithMacro1 ? nextJourneyWithMacro1.startTime.getTime() : Number.POSITIVE_INFINITY
        );

        const orphanEnd = sortedJourneys.find(
          oj => !consumed.has(oj.id) && oj.id !== j.id &&
            oj.vehicleId === j.vehicleId &&
            oj.startTime.getTime() > j.startTime.getTime() &&
            oj.startTime.getTime() <= maxOrphanTime &&
            oj.macros.some(m => m.macroNumber === 2) &&
            !oj.macros.some(m => m.macroNumber === 1)
        );

        if (orphanEnd) {
          // Merge orphan's macros into this journey
          const allMacros = [...j.macros, ...orphanEnd.macros].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
          );
          const macro2 = orphanEnd.macros.find(m => m.macroNumber === 2);
          j.macros = allMacros;
          j.endTime = macro2?.createdAt || null;
          consumed.add(orphanEnd.id);
        }
      }

      if (!hasMacro1 && hasMacro2) {
        // Orphan end with no open journey found — already handled above or skip
        // Check if it was already consumed
        if (!consumed.has(j.id)) {
          // Standalone orphan — still add it but it will show as ended
          mergedJourneys.push(j);
        }
        continue;
      }

      mergedJourneys.push(j);
    }

    // Handle ungrouped events with sequential fallback
    if (ungrouped.length > 0) {
      mergedJourneys.push(...buildJourneysSequential(ungrouped));
    }

    return mergedJourneys.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  // Fallback: sequential grouping for imported/local data
  return buildJourneysSequential(unique);
}

function buildJourneysSequential(events: MacroEvent[]): Journey[] {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const journeys: Journey[] = [];
  let current: Journey | null = null;

  for (const evt of sorted) {
    if (evt.macroNumber === 1) {
      current = {
        id: generateId(),
        vehicleId: evt.vehicleId,
        driverId: evt.driverId || "unknown",
        driverName: evt.driverName || null,
        startTime: evt.createdAt,
        endTime: null,
        macros: [evt],
        date: evt.dataJornada || toDateKey(evt.createdAt),
      };
      journeys.push(current);
    } else if (current) {
      current.macros.push(evt);
      if (evt.macroNumber === 2) {
        current.endTime = evt.createdAt;
        current = null;
      }
    }
  }

  return journeys;
}

/**
 * Calculate journey metrics, optionally clipped to a specific time window.
 */
export function calculateJourney(
  journey: Journey, 
  now: Date = new Date(),
  window?: { start: Date; end: Date }
): JourneyCalculation {
  // Define calculation bounds (No more clipping to 00:00-23:59 window as per user request)
  const calcStart = journey.startTime;
  const journeyEnd = journey.endTime || now;
  
  // Stagnation check: If journey is open for > 24h with no events, cap it at 24h to avoid 60h+ bugs
  const isStale = !journey.endTime && (now.getTime() - journey.startTime.getTime()) > 24 * 60 * 60000;
  const calcEnd = isStale ? new Date(journey.startTime.getTime() + 24 * 60 * 60000) : journeyEnd;

  const grossMinutes = Math.max(0, diffMinutes(calcStart, calcEnd));

  let mealMinutes = 0;
  let restMinutes = 0;
  let complementMinutes = 0;

  const macros = [...journey.macros].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Calculate pauses with clipping
  let openMeal: Date | null = null;
  let openRest: Date | null = null;
  let openComplement: Date | null = null;

  const getClippedDuration = (start: Date, end: Date) => {
    const s = start < calcStart ? calcStart : start;
    const e = end > calcEnd ? calcEnd : end;
    return Math.max(0, diffMinutes(s, e));
  };

  for (const m of macros) {
    switch (m.macroNumber) {
      case 3: openMeal = m.createdAt; break;
      case 4: 
        if (openMeal) { 
          mealMinutes += getClippedDuration(openMeal, m.createdAt); 
          openMeal = null; 
        } 
        break;
      case 5: openRest = m.createdAt; break;
      case 6: 
        if (openRest) { 
          restMinutes += getClippedDuration(openRest, m.createdAt); 
          openRest = null; 
        } 
        break;
      case 9: openComplement = m.createdAt; break;
      case 10: 
        if (openComplement) { 
          complementMinutes += getClippedDuration(openComplement, m.createdAt); 
          openComplement = null; 
        } 
        break;
    }
  }

  // If pause still open, count until calcEnd (which is already clipped to now/end/windowEnd)
  if (openMeal) mealMinutes += getClippedDuration(openMeal, calcEnd);
  if (openRest) restMinutes += getClippedDuration(openRest, calcEnd);
  if (openComplement) complementMinutes += getClippedDuration(openComplement, calcEnd);

  const netMinutes = Math.max(0, grossMinutes - mealMinutes - restMinutes - complementMinutes);
  const overtimeMinutes = Math.max(0, netMinutes - 480); // > 8h
  const remainingMinutes = Math.max(0, 720 - netMinutes); // 12h limit

  // Status is always global (not clipped by window)
  let status: VehicleStatus = "em_jornada";
  if (journey.endTime) {
    status = "em_interjornada";
  } else {
    // Check last open pause globally
    const lastOpenMeal = macros.filter(m => m.macroNumber === 3).pop();
    const lastCloseMeal = macros.filter(m => m.macroNumber === 4).pop();
    const lastOpenRest = macros.filter(m => m.macroNumber === 5).pop();
    const lastCloseRest = macros.filter(m => m.macroNumber === 6).pop();
    const lastOpenComp = macros.filter(m => m.macroNumber === 9).pop();
    const lastCloseComp = macros.filter(m => m.macroNumber === 10).pop();

    const isMealOpen = lastOpenMeal && (!lastCloseMeal || lastCloseMeal.createdAt < lastOpenMeal.createdAt);
    const isRestOpen = lastOpenRest && (!lastCloseRest || lastCloseRest.createdAt < lastOpenRest.createdAt);
    const isCompOpen = lastOpenComp && (!lastCloseComp || lastCloseComp.createdAt < lastOpenComp.createdAt);

    if (isMealOpen) status = "em_refeicao";
    else if (isRestOpen) status = "em_repouso";
    else if (isCompOpen) status = "em_complemento";
    else status = "em_jornada";
  }

  // Meal alert: > 6h since start without macro 3
  const hoursSinceStart = diffMinutes(journey.startTime, now) / 60;
  const hasMealStart = macros.some(m => m.macroNumber === 3);
  const mealAlert = !hasMealStart && hoursSinceStart > 6 && !journey.endTime;

  return {
    grossMinutes,
    mealMinutes,
    restMinutes,
    complementMinutes,
    netMinutes,
    overtimeMinutes,
    remainingMinutes,
    status,
    mealAlert,
    interjournadaAlert: "none",
    interjournadaMinutes: null,
  };
}

/**
 * Find the journey for the selected day.
 */
export function getJourneyForDate(
  journeys: Journey[],
  dateKey: string,
  _now: Date = new Date()
): Journey | null {
  const sameDateJourneys = journeys
    .filter((j) => j.date === dateKey)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (sameDateJourneys.length === 0) return null;

  const openJourneys = sameDateJourneys.filter((j) => !j.endTime);
  if (openJourneys.length > 0) return openJourneys[openJourneys.length - 1];

  return sameDateJourneys[sameDateJourneys.length - 1];
}

/**
 * Calculate journey metrics for the selected day context with daily clipping (00:00 - 23:59).
 */
export function calculateJourneyForDate(
  journey: Journey,
  dateKey: string,
  now: Date = new Date()
): JourneyCalculation {
  const [year, month, day] = dateKey.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

  return calculateJourney(journey, now, { start: dayStart, end: dayEnd });
}

/**
 * Calculate interjornada between two consecutive journeys
 */
export function calculateInterjornada(
  prevJourney: Journey | null,
  currentJourney: Journey
): { alert: "none" | "warning" | "critical"; minutes: number | null } {
  if (!prevJourney || !prevJourney.endTime) return { alert: "none", minutes: null };

  const minutes = diffMinutes(prevJourney.endTime, currentJourney.startTime);
  if (minutes < 480) return { alert: "critical", minutes };
  if (minutes < 660) return { alert: "warning", minutes };
  return { alert: "none", minutes };
}

/**
 * Get current status for a vehicle based on its journeys
 */
export function getVehicleCurrentStatus(journeys: Journey[], now: Date = new Date()): VehicleStatus {
  if (journeys.length === 0) return "em_interjornada";
  const last = journeys[journeys.length - 1];
  return calculateJourney(last, now).status;
}

/**
 * Build 24h timeline segments for a specific day
 */
export function buildTimeline(
  journeys: Journey[],
  dateKey: string,
  showPreviousDay: boolean = true
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];

  // Find journeys that overlap with this day
  const dayStart = new Date(dateKey + "T00:00:00");
  const dayEnd = new Date(dateKey + "T23:59:59");

  // Previous day journeys that spill into this day
  const prevDayKey = toDateKey(new Date(dayStart.getTime() - 86400000));

  for (const j of journeys) {
    const jEnd = j.endTime || new Date();

    // Journey from previous day extending into this day
    if (j.date !== dateKey && j.date === prevDayKey) {
      if (jEnd > dayStart) {
        if (!showPreviousDay) continue;
        const segEnd = Math.min(toMinuteOfDay(jEnd), 1439);
        addJourneySegments(segments, j, 0, segEnd, true);
      }
      continue;
    }

    // Journey starting on this day
    if (j.date === dateKey) {
      const startMin = toMinuteOfDay(j.startTime);
      let endMin: number;
      if (j.endTime && toDateKey(j.endTime) === dateKey) {
        endMin = toMinuteOfDay(j.endTime);
      } else if (j.endTime && toDateKey(j.endTime) !== dateKey) {
        endMin = 1439; // goes to end of day
      } else {
        endMin = toMinuteOfDay(new Date()); // ongoing
      }
      addJourneySegments(segments, j, startMin, endMin, false);
    }
  }

  // Fill gaps with inactive
  return fillGaps(segments);
}

function addJourneySegments(
  segments: TimelineSegment[],
  journey: Journey,
  rangeStart: number,
  rangeEnd: number,
  isPreviousDay: boolean
): void {
  const macros = [...journey.macros].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  // Build status intervals from macros
  interface Interval {
    start: Date;
    end: Date;
    status: VehicleStatus;
    macro: MacroNumber;
  }

  const intervals: Interval[] = [];
  let currentStatus: VehicleStatus = "em_jornada";
  let lastTime = journey.startTime;

  for (let i = 0; i < macros.length; i++) {
    const m = macros[i];
    if (m.macroNumber === 1) {
      currentStatus = "em_jornada";
      lastTime = m.createdAt;
      continue;
    }

    if ([3, 5, 9].includes(m.macroNumber)) {
      // Close previous interval
      if (lastTime < m.createdAt) {
        intervals.push({ start: lastTime, end: m.createdAt, status: currentStatus, macro: 1 as MacroNumber });
      }
      const statusMap: Record<number, VehicleStatus> = {
        3: "em_refeicao", 5: "em_repouso", 9: "em_complemento"
      };
      currentStatus = statusMap[m.macroNumber];
      lastTime = m.createdAt;
    } else if ([4, 6, 10].includes(m.macroNumber)) {
      intervals.push({ start: lastTime, end: m.createdAt, status: currentStatus, macro: m.macroNumber as MacroNumber });
      currentStatus = "em_jornada";
      lastTime = m.createdAt;
    } else if (m.macroNumber === 2) {
      intervals.push({ start: lastTime, end: m.createdAt, status: currentStatus, macro: m.macroNumber as MacroNumber });
      currentStatus = "em_interjornada";
      lastTime = m.createdAt;
    }
  }

  // If journey still open
  if (!journey.endTime && lastTime < new Date()) {
    intervals.push({ start: lastTime, end: new Date(), status: currentStatus, macro: 1 as MacroNumber });
  }

  // Convert intervals to timeline segments within range
  const dayDate = isPreviousDay
    ? new Date(new Date(journey.date + "T00:00:00").getTime() + 86400000)
    : new Date(journey.date + "T00:00:00");

  for (const interval of intervals) {
    let startMin: number;
    let endMin: number;

    if (toDateKey(interval.start) === toDateKey(dayDate)) {
      startMin = toMinuteOfDay(interval.start);
    } else if (interval.start < dayDate) {
      startMin = 0;
    } else {
      continue;
    }

    if (toDateKey(interval.end) === toDateKey(dayDate)) {
      endMin = toMinuteOfDay(interval.end);
    } else if (interval.end > dayDate) {
      endMin = 1439;
    } else {
      continue;
    }

    // Clamp to range
    startMin = Math.max(startMin, rangeStart);
    endMin = Math.min(endMin, rangeEnd);

    if (startMin < endMin) {
      segments.push({
        startMinute: startMin,
        endMinute: endMin,
        status: interval.status,
        isPreviousDay,
        macro: interval.macro,
        journeyDate: journey.date,
      });
    }
  }
}

function fillGaps(segments: TimelineSegment[]): TimelineSegment[] {
  if (segments.length === 0) {
    return [{ startMinute: 0, endMinute: 1439, status: "inactive", isPreviousDay: false }];
  }

  const sorted = [...segments].sort((a, b) => a.startMinute - b.startMinute);
  const result: TimelineSegment[] = [];
  let lastEnd = 0;

  for (const seg of sorted) {
    if (seg.startMinute > lastEnd) {
      result.push({ startMinute: lastEnd, endMinute: seg.startMinute, status: "inactive", isPreviousDay: false });
    }
    result.push(seg);
    lastEnd = Math.max(lastEnd, seg.endMinute);
  }

  if (lastEnd < 1439) {
    result.push({ startMinute: lastEnd, endMinute: 1439, status: "inactive", isPreviousDay: false });
  }

  return result;
}

/**
 * Validate macro limits for a date
 */
export function validateMacroLimits(
  existingEvents: MacroEvent[],
  newMacro: MacroNumber,
  vehicleId: string,
  date: string
): boolean {
  const dayEvents = existingEvents.filter(
    e => e.vehicleId === vehicleId && toDateKey(e.createdAt) === date && e.macroNumber === newMacro
  );
  return dayEvents.length < DAILY_MACRO_LIMITS[newMacro];
}

/**
 * Check for duplicate events
 */
export function isDuplicate(
  existingEvents: MacroEvent[],
  vehicleId: string,
  macroNumber: MacroNumber,
  createdAt: Date
): boolean {
  return existingEvents.some(
    e =>
      e.vehicleId === vehicleId &&
      e.macroNumber === macroNumber &&
      e.createdAt.getTime() === createdAt.getTime()
  );
}
