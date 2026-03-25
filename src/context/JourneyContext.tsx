import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Vehicle, MacroEvent, MacroNumber, Journey } from "@/types/journey";
import { buildJourneys, generateId, toDateKey } from "@/lib/journeyEngine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
const LOAD_TIMEOUT_MS = 30_000;
const BASE_REFRESH_INTERVAL_MS = 30_000;
const MAX_REFRESH_INTERVAL_MS = 5 * 60_000;
const REALTIME_DEBOUNCE_MS = 500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number = LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("BACKEND_TIMEOUT")), timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeout);
        reject(error);
      });
  });
}

function runWithTimeout<T>(operation: Promise<T> | PromiseLike<T>, timeoutMs: number = LOAD_TIMEOUT_MS): Promise<T> {
  return withTimeout(Promise.resolve(operation), timeoutMs);
}

function isBackendUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("backend_timeout") ||
    msg.includes("connection timeout") ||
    msg.includes("request canceled") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("status 544") ||
    msg.includes("socket hang up") ||
    msg.includes("eof") ||
    msg.includes("connection refused") ||
    msg.includes("failed to connect")
  );
}

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
  const isFirstLoad = useRef(true);
  const isFetchingRef = useRef(false);
  const fetchRef = useRef<(() => Promise<void>) | null>(null);
  const realtimeDebounceTimerRef = useRef<number | null>(null);
  const autoRefreshTimerRef = useRef<number | null>(null);
  const autoRefreshDelayRef = useRef(BASE_REFRESH_INTERVAL_MS);
  const outageToastShownRef = useRef(false);

  const clearAutoRefreshTimer = useCallback(() => {
    if (autoRefreshTimerRef.current !== null) {
      window.clearTimeout(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }
  }, []);

  const scheduleAutoRefresh = useCallback((delayMs: number) => {
    clearAutoRefreshTimer();
    autoRefreshTimerRef.current = window.setTimeout(() => {
      void fetchRef.current?.();
    }, delayMs);
  }, [clearAutoRefreshTimer]);

  // Load data from local DB tables
  const loadLocalData = useCallback(async (trigger: "auto" | "manual" = "manual") => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (isFirstLoad.current) {
      setIsLoading(true);
    } else {
      setIsSyncing(true);
    }

    if (trigger === "manual") {
      autoRefreshDelayRef.current = BASE_REFRESH_INTERVAL_MS;
    }

    setError(null);

    try {
      // Fetch vehicles from local autotrac_vehicles table
      const { data: vehiclesData, error: vErr } = await runWithTimeout<any>((supabase as any)
        .from("autotrac_vehicles")
        .select("*")
        .order("name"));

      if (vErr) throw vErr;

      // Fetch cadastros (local bindings)
      const { data: cadastrosData, error: cErr } = await runWithTimeout<any>(supabase
        .from("cadastros")
        .select("veiculo_id, motorista_nome, gestor_nome, numero_frota, nome_veiculo")
        .eq("ativo", true));

      if (cErr) throw cErr;

      // Build cadastro lookup by both veiculo_id and numero_frota
      const cadastroById = new Map<string, any>();
      if (cadastrosData) {
        for (const c of cadastrosData) {
          cadastroById.set(c.veiculo_id, {
            veiculo_id: c.veiculo_id,
            motorista_nome: c.motorista_nome,
            gestor_nome: c.gestor_nome,
            numero_frota: c.numero_frota,
            nome_veiculo: c.nome_veiculo,
          });
        }
      }

      const mappedVehicles: Vehicle[] = (vehiclesData || []).map((v: any) => {
        const vehicleName = (v.name?.trim() || `Veículo ${v.vehicle_code}`);
        const numMatch = vehicleName.match(/^(\d+)/);
        const frotaNum = numMatch ? numMatch[1] : "";
        const cadastro = cadastroById.get(String(v.vehicle_code));
        const finalName = cadastro?.nome_veiculo?.trim() ? cadastro.nome_veiculo : vehicleName;
        return {
          id: String(v.vehicle_code),
          name: finalName,
          numeroFrota: cadastro?.numero_frota || frotaNum,
          driverName: cadastro?.motorista_nome || null,
          gestorName: cadastro?.gestor_nome || null,
          externalVehicleId: cadastro?.veiculo_id || null,
        };
      });

      setVehicles(mappedVehicles);
      setCadastros(cadastrosData || []);
      setAutotracVehicles(vehiclesData || []);

      // Fetch events from local autotrac_eventos with fallback window
      const fetchEventsByWindow = async (daysWindow: number, pageSize: number = 600, includeDriverPassword = true) => {
        const start = new Date();
        start.setDate(start.getDate() - daysWindow);

        const fields = includeDriverPassword
          ? "id, vehicle_code, macro_number, message_time, landmark, latitude, longitude, driver_password, raw_data"
          : "id, vehicle_code, macro_number, message_time, landmark, latitude, longitude";

        let all: any[] = [];
        let from = 0;

        while (true) {
          const { data: page, error: eErr } = await runWithTimeout<any>((supabase as any)
            .from("autotrac_eventos")
            .select(fields)
            .gte("message_time", start.toISOString())
            .order("message_time", { ascending: true })
            .range(from, from + pageSize - 1));

          if (eErr) throw eErr;
          if (!page || page.length === 0) break;
          all = all.concat(page);
          if (page.length < pageSize) break;
          from += pageSize;
        }

        return all;
      };

      let eventsWindowDays = 7;
      let allEvents: any[] = [];
      let hasDriverPassword = true;

      try {
        allEvents = await fetchEventsByWindow(eventsWindowDays, 600, true);
      } catch (primaryErr: any) {
        // If the error is a missing column (migration not applied yet), retry without it
        const errMsg = String(primaryErr?.message || primaryErr).toLowerCase();
        if (errMsg.includes("driver_password") || errMsg.includes("column") || errMsg.includes("does not exist")) {
          hasDriverPassword = false;
          try {
            allEvents = await fetchEventsByWindow(eventsWindowDays, 600, false);
          } catch (fallbackErr) {
            if (!isBackendUnavailableError(fallbackErr)) throw fallbackErr;
            eventsWindowDays = 2;
            allEvents = await fetchEventsByWindow(eventsWindowDays, 400, false);
          }
        } else if (!isBackendUnavailableError(primaryErr)) {
          throw primaryErr;
        } else {
          eventsWindowDays = 2;
          try {
            allEvents = await fetchEventsByWindow(eventsWindowDays, 400, true);
          } catch {
            hasDriverPassword = false;
            allEvents = await fetchEventsByWindow(eventsWindowDays, 400, false);
          }
        }
      }

      // Build a senha→driver lookup map from motoristas table (gracefully: column may not exist yet)
      const driverBySenha = new Map<string, { id: string; nome: string }>();
      if (hasDriverPassword) {
        try {
          const { data: motoristasData } = await runWithTimeout<any>((supabase as any)
            .from("motoristas")
            .select("id, nome, senha")
            .eq("ativo", true));

          if (motoristasData) {
            for (const mot of motoristasData) {
              if (mot.senha) driverBySenha.set(mot.senha, { id: mot.id, nome: mot.nome });
            }
            setMotoristas(motoristasData);
          }
        } catch {
          // senha column not yet migrated — skip driver identification silently
        }
      }

      const mappedEvents: MacroEvent[] = allEvents
        .filter((e: any) => VALID_MACROS.has(e.macro_number))
        .map((e: any) => {
          const passwordMatch = e.raw_data?.MessageText ? String(e.raw_data.MessageText).match(/^_(\w+)/) : null;
          const extractedPassword = e.driver_password || (passwordMatch ? passwordMatch[1] : null);
          const driver = extractedPassword ? driverBySenha.get(extractedPassword) : null;
          return {
            id: e.id,
            vehicleId: String(e.vehicle_code),
            macroNumber: e.macro_number as MacroNumber,
            createdAt: new Date(e.message_time),
            endereco: e.landmark || null,
            latitude: e.latitude ? Number(e.latitude) : null,
            longitude: e.longitude ? Number(e.longitude) : null,
            dataJornada: toDateKey(new Date(e.message_time)),
            driverId: driver?.id || null,
            driverName: driver?.nome || null,
          };
        });

      // Deduplicate by vehicle+macro+timestamp
      const keyMap = new Map<string, number>();
      const deduped: MacroEvent[] = [];
      for (const evt of mappedEvents) {
        const key = `${evt.vehicleId}_${evt.macroNumber}_${evt.createdAt.getTime()}`;
        if (!keyMap.has(key)) {
          keyMap.set(key, deduped.length);
          deduped.push(evt);
        }
      }

      // Fetch manual macro overrides
      const { data: overridesData, error: oErr } = await runWithTimeout<any>((supabase as any)
        .from("macro_overrides")
        .select("*")
        .order("created_at", { ascending: true }));

      if (oErr) throw oErr;

      // Apply overrides to events
      let finalEvents = [...deduped];

      if (overridesData && overridesData.length > 0) {
        const deletedIds = new Set<string>();
        const editedIds = new Map<string, any>(); // original_event_id -> override
        const newDayMarks = new Map<string, DayMarkInfo>();

        for (const ov of overridesData) {
          if (ov.action === "delete" && ov.original_event_id) {
            deletedIds.add(ov.original_event_id);
          } else if (ov.action === "edit" && ov.original_event_id) {
            editedIds.set(ov.original_event_id, ov);
          } else if (ov.action === "insert") {
            // Add as a new synthetic event
            finalEvents.push({
              id: `manual_${ov.id}`,
              vehicleId: String(ov.vehicle_code),
              macroNumber: ov.macro_number as MacroNumber,
              createdAt: new Date(ov.event_time),
              endereco: null,
              latitude: null,
              longitude: null,
              dataJornada: toDateKey(new Date(ov.event_time)),
              isManual: true,
            } as any);
          }
        }

        // Remove deleted events
        finalEvents = finalEvents.filter(e => !deletedIds.has(e.id));

        // Apply edits
        finalEvents = finalEvents.map(e => {
          const edit = editedIds.get(e.id);
          if (edit) {
            return {
              ...e,
              macroNumber: edit.macro_number as MacroNumber,
              createdAt: new Date(edit.event_time),
              dataJornada: toDateKey(new Date(edit.event_time)),
              isManual: true,
            } as any;
          }
          return e;
        });
      }

      console.log(`Loaded ${deduped.length} events (${overridesData?.length || 0} overrides), ${mappedVehicles.length} vehicles from local DB`);
      setEvents(finalEvents);

      // Fetch positions from local autotrac_positions table
      const { data: posData, error: pErr } = await runWithTimeout<any>((supabase as any)
        .from("autotrac_positions")
        .select("vehicle_code, landmark, latitude, longitude, position_time"));

      if (pErr) throw pErr;

      if (posData) {
        const posMap = new Map<string, { endereco: string; latitude: number | null; longitude: number | null; dataPosicao: string | null }>();
        for (const p of posData) {
          posMap.set(String(p.vehicle_code), {
            endereco: (p as any).landmark?.trim() || "",
            latitude: p.latitude ? Number(p.latitude) : null,
            longitude: p.longitude ? Number(p.longitude) : null,
            dataPosicao: p.position_time || null,
          });
        }
        setVehiclePositions(posMap);
      }

      if (eventsWindowDays < 7) {
        setError("Conexão instável: exibindo dados parciais dos últimos 2 dias enquanto reconecta.");
        if (trigger === "manual" || !outageToastShownRef.current) {
          toast.warning("Conexão instável detectada. Exibindo apenas os dados mais recentes para manter o sistema operacional.");
          outageToastShownRef.current = true;
        }
      } else {
        setError(null);
        outageToastShownRef.current = false;
      }

      setLastSyncAt(new Date());
      autoRefreshDelayRef.current = BASE_REFRESH_INTERVAL_MS;
      scheduleAutoRefresh(BASE_REFRESH_INTERVAL_MS);
    } catch (err: any) {
      console.error("Erro ao carregar dados locais:", err);

      const backendUnavailable = isBackendUnavailableError(err);
      const message = err instanceof Error ? err.message : "Erro ao carregar dados";

      if (backendUnavailable) {
        const nextDelay = Math.min(autoRefreshDelayRef.current * 2, MAX_REFRESH_INTERVAL_MS);
        autoRefreshDelayRef.current = nextDelay;
        setError("Conexão com o backend indisponível. O sistema está tentando reconectar automaticamente.");
        scheduleAutoRefresh(nextDelay);

        if (trigger === "manual" || !outageToastShownRef.current) {
          toast.error("Servidor indisponível no momento. Tentaremos reconectar automaticamente.");
          outageToastShownRef.current = true;
        }
      } else {
        setError(message);
        scheduleAutoRefresh(BASE_REFRESH_INTERVAL_MS);

        if (trigger === "manual") {
          toast.error("Erro ao carregar dados do banco local");
        }
      }
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
      setIsSyncing(false);
      isFirstLoad.current = false;
    }
  }, [scheduleAutoRefresh]);
  
  // Debounced version of loadLocalData specifically for Realtime events
  const debouncedLoadLocalData = useCallback(() => {
    if (realtimeDebounceTimerRef.current) window.clearTimeout(realtimeDebounceTimerRef.current);
    realtimeDebounceTimerRef.current = window.setTimeout(() => {
      void loadLocalData("auto");
    }, REALTIME_DEBOUNCE_MS);
  }, [loadLocalData]);

  // Sync from Autotrac API via edge function
  const syncFromAutotrac = useCallback(async () => {
    setIsSyncing(true);
    try {
      toast.info("Sincronizando com Autotrac...");

      const { data, error: fnErr } = await runWithTimeout<any>(supabase.functions.invoke("autotrac-sync"), 60_000); // 60s timeout

      if (fnErr) throw fnErr;

      if (data?.success) {
        toast.success(
          `Sincronizado: ${data.vehicles} veículos, ${data.events} eventos`
        );
        // Reload local data after sync
        await loadLocalData("manual");
      } else {
        throw new Error(data?.error || "Erro desconhecido na sincronização");
      }
    } catch (err: any) {
      console.error("Erro ao sincronizar com Autotrac:", err);
      if (isBackendUnavailableError(err)) {
        toast.error("Servidor indisponível. Tente novamente em alguns instantes.");
      } else {
        toast.error(`Erro na sincronização: ${err.message}`);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [loadLocalData]);

  // Initial load with adaptive auto-refresh and REALTIME
  useEffect(() => {
    fetchRef.current = () => loadLocalData("auto");
    void loadLocalData("auto");

    // Subscribe to Realtime changes
    const channel = supabase
      .channel("auto-refresh-channel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "autotrac_eventos" },
        () => {
          console.log("[REALTIME] Novo evento detectado, agendando atualização...");
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
      clearAutoRefreshTimer();
      clearInterval(syncInterval);
      if (realtimeDebounceTimerRef.current) window.clearTimeout(realtimeDebounceTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadLocalData, debouncedLoadLocalData, clearAutoRefreshTimer, syncFromAutotrac]);

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

  const refreshData = useCallback(() => {
    void loadLocalData("manual");
  }, [loadLocalData]);

  const getDayMark = useCallback((vehicleId: string, date: string): DayMarkInfo | null => {
    // vehicleId is the string vehicle_code used in the app
    return dayMarks.get(`${vehicleId}_${date}`) || null;
  }, [dayMarks]);

  const value = useMemo(
    () => ({
      vehicles, events, selectedDate, setSelectedDate, addEvents,
      getVehicleEvents, getVehicleJourneys, getDriverJourneys, getAllJourneys, clearData,
      isLoading, isSyncing, error, folgaVehicles, toggleFolga,
      vehiclePositions, refreshData, lastSyncAt, syncFromAutotrac,
      dayMarks, getDayMark, motoristas, cadastros, autotracVehicles
    }),
    [vehicles, events, selectedDate, addEvents, getVehicleEvents, getVehicleJourneys, getDriverJourneys, getAllJourneys, clearData, isLoading, isSyncing, error, folgaVehicles, toggleFolga, vehiclePositions, refreshData, lastSyncAt, syncFromAutotrac, dayMarks, getDayMark, motoristas, cadastros, autotracVehicles]
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
