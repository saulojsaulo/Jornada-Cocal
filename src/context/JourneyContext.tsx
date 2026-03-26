import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Vehicle, MacroEvent, MacroNumber, Journey } from "@/types/journey";
import { buildJourneys, generateId, toDateKey } from "@/lib/journeyEngine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboardData } from "@/hooks/useDashboardData";

export type DayMarkType = "folga" | "falta" | "atestado" | "afastamento";

export interface DayMarkInfo {
  type: DayMarkType;
  reason: string;
  id: string;
  vehicleCode: number;
}

interface JourneyStore {
  vehicles: Vehicle[];
  events: MacroEvent[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  addEvents: (newEvents: { vehicleName: string; macroNumber: MacroNumber; createdAt: Date }[]) => { added: number; skipped: number };
  getVehicleEvents: (vehicleId: string) => MacroEvent[];
  getVehicleJourneys: (vehicleId: string) => Journey[];
  getDriverJourneys: (driverId: string) => Journey[];
  getAllJourneys: () => Journey[];
  clearData: () => void;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  folgaVehicles: Set<string>;
  toggleFolga: (vehicleId: string) => void;
  vehiclePositions: Map<string, { endereco: string; latitude: number | null; longitude: number | null; dataPosicao: string | null }>;
  refreshData: () => void;
  lastSyncAt: Date | null;
  syncFromAutotrac: () => void;
  /** Day marks from macro_overrides keyed by "vehicleCode_YYYY-MM-DD" */
  dayMarks: Map<string, DayMarkInfo>;
  /** Day marks from macro_overrides keyed by "driverId_YYYY-MM-DD" */
  driverDayMarks: Map<string, DayMarkInfo>;
  /** Get day mark for a vehicle id on a given date */
  getDayMark: (vehicleId: string, date: string) => DayMarkInfo | null;
  /** Get day mark for a driver id (folgas specific to drivers unconditionally) on a given date */
  getDriverDayMark: (driverId: string, date: string) => DayMarkInfo | null;
  motoristas: any[];
  cadastros: any[];
  autotracVehicles: any[];
}

const JourneyContext = createContext<JourneyStore | null>(null);

const VALID_MACROS = new Set([1, 2, 3, 4, 5, 6, 9, 10]);
let hmrReloadScheduled = false;

const DAY_MARK_ACTIONS = new Set(["folga", "falta", "atestado", "afastamento"]);

const HMR_FALLBACK_STORE: JourneyStore = {
  vehicles: [],
  events: [],
  selectedDate: toDateKey(new Date()),
  setSelectedDate: () => {},
  addEvents: () => ({ added: 0, skipped: 0 }),
  getVehicleEvents: () => [],
  getVehicleJourneys: () => [],
  getDriverJourneys: () => [],
  getAllJourneys: () => [],
  clearData: () => {},
  isLoading: true,
  isSyncing: false,
  error: null,
  folgaVehicles: new Set<string>(),
  toggleFolga: () => {},
  vehiclePositions: new Map(),
  refreshData: () => {},
  lastSyncAt: null,
  syncFromAutotrac: () => {},
  dayMarks: new Map(),
  driverDayMarks: new Map(),
  getDayMark: () => null,
  getDriverDayMark: () => null,
  motoristas: [],
  cadastros: [],
  autotracVehicles: [],
};

export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(toDateKey(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folgaVehicles, setFolgaVehicles] = useState<Set<string>>(new Set());
  const [dayMarks, setDayMarks] = useState<Map<string, DayMarkInfo>>(new Map());
  const [driverDayMarks, setDriverDayMarks] = useState<Map<string, DayMarkInfo>>(new Map());
  const [vehiclePositions, setVehiclePositions] = useState<Map<string, { endereco: string; latitude: number | null; longitude: number | null; dataPosicao: string | null }>>(new Map());
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [motoristas, setMotoristas] = useState<any[]>([]);
  const [cadastros, setCadastros] = useState<any[]>([]);
  const [autotracVehicles, setAutotracVehicles] = useState<any[]>([]);
  
  const queryClient = useQueryClient();
  const { data: queryData, isLoading: queryLoading, error: queryError, isFetching: querySyncing } = useDashboardData(7); // Fetch 7 days for full visibility

  // Sincronização automática via React Query.
  // Sync data from queryData to state
  useEffect(() => {
    if (queryData) {
      console.log(`[STATE] Sincronizando dados do cache para o estado do contexto...`);
      
      // Map vehicles
      const mappedVehicles: Vehicle[] = queryData.vehicles.map((v: any) => {
        const cadastro = queryData.cadastros.find((c: any) => String(c.veiculo_id) === String(v.vehicle_code) || String(c.numero_frota) === String(v.vehicle_code));
        return {
          id: String(v.vehicle_code),
          name: v.name,
          numeroFrota: cadastro?.numero_frota || "",
          driverName: cadastro?.motorista_nome || null,
          gestorName: cadastro?.gestor_nome || null,
          externalVehicleId: v.id,
        };
      });
      setVehicles(mappedVehicles);
      setCadastros(queryData.cadastros);
      setAutotracVehicles(queryData.vehicles);
      setMotoristas(queryData.motoristas);

      // Map events
      const mappedEvents: MacroEvent[] = queryData.events.map((e: any) => ({
        id: e.id,
        vehicleId: String(e.vehicle_code),
        macroNumber: e.macro_number as MacroNumber,
        createdAt: new Date(e.message_time),
        isManual: false,
        endereco: e.landmark || null,
        latitude: e.latitude ? Number(e.latitude) : null,
        longitude: e.longitude ? Number(e.longitude) : null,
        dataJornada: toDateKey(new Date(e.message_time)),
        driverId: e.driver_id || null,
        driverName: e.driver_name || null,
      }));
      setEvents(mappedEvents);

      // Map positions
      const posMap = new Map();
      queryData.positions.forEach((p: any) => {
        posMap.set(String(p.vehicle_code), {
          endereco: p.landmark?.trim() || "",
          latitude: p.latitude ? Number(p.latitude) : null,
          longitude: p.longitude ? Number(p.longitude) : null,
          dataPosicao: p.position_time || null,
        });
      });
      setVehiclePositions(posMap);

      // Map day marks from overrides
      const marks = new Map<string, DayMarkInfo>();
      const dMarks = new Map<string, DayMarkInfo>();
      queryData.overrides.forEach((o: any) => {
        if (DAY_MARK_ACTIONS.has(o.action)) {
          const info: DayMarkInfo = {
            type: o.action as DayMarkType,
            reason: o.reason || "",
            id: o.id,
            vehicleCode: o.vehicle_code,
          };
          const dateKey = toDateKey(new Date(o.event_time));
          marks.set(`${o.vehicle_code}_${dateKey}`, info);
          
          const motorista = queryData.cadastros.find((c: any) => String(c.veiculo_id) === String(o.vehicle_code));
          if (motorista?.motorista_nome) {
            dMarks.set(`${motorista.motorista_nome}_${dateKey}`, info);
          }
        }
      });
      setDayMarks(marks);
      setDriverDayMarks(dMarks);
      
      setLastSyncAt(new Date(queryData.syncedAt));
      setError(null);
    }
  }, [queryData]);

  // Handle errors from React Query
  useEffect(() => {
    if (queryError) {
      const msg = (queryError as any)?.context?.error || (queryError as any)?.message || "Erro desconhecido";
      const tag = (queryError as any)?.context?.tag || "";
      setError(`Falha na sincronização: ${msg} ${tag ? `[Tag: ${tag}]` : ""}`);
    }
  }, [queryError]);

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
  }, [queryClient]);

  const debouncedLoadLocalData = useCallback(() => {
    refreshData();
  }, [refreshData]);

  const syncFromAutotrac = useCallback(async () => {
    // Sincronização agora é gerida pelo backend (Edge Functions + pg_cron)
    // Para manter compatibilidade de UI se alguém clicar no botão "Sincronizar":
    toast.info("Iniciando sincronização forçada via Edge Function...");
    const { error } = await supabase.functions.invoke("autotrac-sync");
    if (error) {
      toast.error("Falha ao disparar sincronização manual");
    } else {
      toast.success("Comando de sincronização enviado com sucesso");
      refreshData();
    }
  }, [refreshData]);

  // Realtime Subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("global-updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "autotrac_eventos" },
        () => {
          console.log("[REALTIME] Novo evento detectado, invalidando cache...");
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autotrac_positions" },
        () => {
          // Positions can change frequently, debounce is essential here
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "macro_overrides" },
        () => {
          console.log("[REALTIME] Ajuste manual detectado, atualizando...");
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetria_sync" },
        () => {
          console.log("[REALTIME] Nova telemetria detectada, atualizando...");
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "motoristas" },
        () => {
          console.log("[REALTIME] Cadastro de motorista alterado, atualizando...");
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cadastros" },
        () => {
          console.log("[REALTIME] Vínculo de frota/motorista alterado, atualizando...");
          debouncedLoadLocalData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autotrac_vehicles" },
        () => {
          console.log("[REALTIME] Veículo alterado, atualizando...");
          debouncedLoadLocalData();
        }
      )
      .subscribe();

    // 10-minute Background Sync from Autotrac Cloud
    // This ensures data is pulled from Autotrac API automatically every 10 mins
    const syncInterval = setInterval(() => {
      console.log("[AUTO-SYNC] Iniciando sincronização programada com Autotrac...");
      void syncFromAutotrac();
    }, 10 * 60 * 1000);

    return () => {
      // No longer needed with React Query
      // if (realtimeDebounceTimerRef.current) window.clearTimeout(realtimeDebounceTimerRef.current);
      supabase.removeChannel(channel);
      clearInterval(syncInterval);
    };
  }, [debouncedLoadLocalData, syncFromAutotrac]);

  // Keep addEvents for XLSX import compatibility
  const addEvents = useCallback(
    (newEvents: { vehicleName: string; macroNumber: MacroNumber; createdAt: Date }[]) => {
      let added = 0;
      let skipped = 0;

      setVehicles((prevVehicles) => {
        const vehicleMap = new Map(prevVehicles.map((v) => [v.name, v]));

        setEvents((prevEvents) => {
          const updatedEvents = [...prevEvents];

          for (const evt of newEvents) {
            if (!vehicleMap.has(evt.vehicleName)) {
              const newVehicle: Vehicle = { id: generateId(), name: evt.vehicleName, numeroFrota: "", driverName: null, gestorName: null, externalVehicleId: null };
              vehicleMap.set(evt.vehicleName, newVehicle);
            }

            const vehicle = vehicleMap.get(evt.vehicleName)!;
            const isDup = updatedEvents.some(
              (e) => e.vehicleId === vehicle.id && e.macroNumber === evt.macroNumber && e.createdAt.getTime() === evt.createdAt.getTime()
            );

            if (isDup) { skipped++; continue; }

            updatedEvents.push({ id: generateId(), vehicleId: vehicle.id, macroNumber: evt.macroNumber, createdAt: evt.createdAt });
            added++;
          }

          return updatedEvents;
        });

        return Array.from(vehicleMap.values());
      });

      return { added, skipped };
    },
    []
  );

  const getVehicleEvents = useCallback(
    (vehicleId: string) =>
      events.filter((e) => e.vehicleId === vehicleId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    [events]
  );

  const getVehicleJourneys = useCallback(
    (vehicleId: string) => buildJourneys(events.filter((e) => e.vehicleId === vehicleId)),
    [events]
  );

  const getDriverJourneys = useCallback(
    (driverId: string) => buildJourneys(events.filter((e) => e.driverId === driverId)),
    [events]
  );

  const getAllJourneys = useCallback(() => {
    // Group events by driverId (primary) for driver-centric journey building.
    // Events without a driver fall back to vehicle grouping.
    const byDriver = new Map<string, MacroEvent[]>();
    for (const e of events) {
      const key = e.driverId || `vehicle_${e.vehicleId}`;
      if (!byDriver.has(key)) byDriver.set(key, []);
      byDriver.get(key)!.push(e);
    }
    const all: Journey[] = [];
    for (const [, evts] of byDriver) {
      all.push(...buildJourneys(evts));
    }
    return all;
  }, [events]);

  const clearData = useCallback(() => {
    setVehicles([]);
    setEvents([]);
  }, []);

  const toggleFolga = useCallback((vehicleId: string) => {
    setFolgaVehicles((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleId)) next.delete(vehicleId);
      else next.add(vehicleId);
      return next;
    });
  }, []);

  const getDayMark = useCallback((vehicleId: string, date: string): DayMarkInfo | null => {
    // vehicleId is the string vehicle_code used in the app
    return dayMarks.get(`${vehicleId}_${date}`) || null;
  }, [dayMarks]);

  const getDriverDayMark = useCallback((driverId: string, date: string): DayMarkInfo | null => {
    return driverDayMarks.get(`${driverId}_${date}`) || null;
  }, [driverDayMarks]);

  const value = useMemo(
    () => ({
      vehicles, events, selectedDate, setSelectedDate, addEvents,
      getVehicleEvents, getVehicleJourneys, getDriverJourneys, getAllJourneys, clearData,
      isLoading: queryLoading || isLoading,
      isSyncing: querySyncing || isSyncing,
      error,
      folgaVehicles,
      toggleFolga,
      vehiclePositions, refreshData, lastSyncAt, syncFromAutotrac,
      dayMarks, driverDayMarks, getDayMark, getDriverDayMark, motoristas, cadastros, autotracVehicles
    }),
    [vehicles, events, selectedDate, addEvents, getVehicleEvents, getVehicleJourneys, getDriverJourneys, getAllJourneys, clearData, isLoading, isSyncing, error, folgaVehicles, toggleFolga, vehiclePositions, refreshData, lastSyncAt, syncFromAutotrac, dayMarks, driverDayMarks, getDayMark, getDriverDayMark, motoristas, cadastros, autotracVehicles, queryLoading, querySyncing]
  );

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourneyStore() {
  const ctx = useContext(JourneyContext);
  if (!ctx) {
    if (import.meta.hot) {
      if (!hmrReloadScheduled) {
        hmrReloadScheduled = true;
        setTimeout(() => window.location.reload(), 0);
      }
      return HMR_FALLBACK_STORE;
    }
    throw new Error("useJourneyStore must be used within JourneyProvider");
  }
  return ctx;
}
