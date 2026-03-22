export type TabType = "controle" | "ranking" | "cadastros" | "cadastro_veiculo" | "cadastro_motorista" | "cadastro_gestor" | "usuarios" | "relatorios";

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string;
}

export interface Driver {
  id: string;
  name: string;
  cpf: string;
  cnh: string;
  telefone: string;
  endereco: string;
}

export interface Gestor {
  id: string;
  name: string;
  email: string;
  telefone: string;
}

export interface Vehicle {
  id: string;
  name: string;
  numeroFrota: string;
  driverName: string | null;
  gestorName: string | null;
  externalVehicleId: string | null;
}

export interface MacroEvent {
  id: string;
  vehicleId: string;
  macroNumber: MacroNumber;
  createdAt: Date;
  journeyId?: string;
  dataJornada?: string;
  endereco?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  driverId?: string | null;
  driverName?: string | null;
}

export type MacroNumber = 1 | 2 | 3 | 4 | 5 | 6 | 9 | 10;

export const MACRO_LABELS: Record<MacroNumber, string> = {
  1: "Início de Jornada",
  2: "Fim de Jornada",
  3: "Início de Refeição",
  4: "Fim de Refeição",
  5: "Início de Repouso",
  6: "Fim de Repouso",
  9: "Início Complemento Interjornada",
  10: "Fim Complemento Interjornada",
};

export const MACRO_PAIRS: Record<number, number> = {
  1: 2, 3: 4, 5: 6, 9: 10,
};

export const DAILY_MACRO_LIMITS: Record<MacroNumber, number> = {
  1: 1, 2: 1, 3: 2, 4: 2, 5: 5, 6: 5, 9: 1, 10: 1,
};

export type VehicleStatus =
  | "em_jornada"
  | "em_refeicao"
  | "em_repouso"
  | "em_complemento"
  | "em_interjornada"
  | "em_folga";

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  em_jornada: "Em Jornada",
  em_refeicao: "Em Refeição",
  em_repouso: "Em Repouso",
  em_complemento: "Em Complemento",
  em_interjornada: "Em Interjornada",
  em_folga: "Em Folga",
};

export const STATUS_ROW_CLASSES: Record<VehicleStatus, string> = {
  em_jornada: "status-row-journey",
  em_refeicao: "status-row-meal",
  em_repouso: "status-row-rest",
  em_complemento: "status-row-complement",
  em_interjornada: "status-row-end",
  em_folga: "",
};

export interface Journey {
  id: string;
  vehicleId: string;
  driverId: string;
  driverName: string | null;
  startTime: Date;
  endTime: Date | null;
  macros: MacroEvent[];
  date: string;
}

export interface JourneyCalculation {
  grossMinutes: number;
  mealMinutes: number;
  restMinutes: number;
  complementMinutes: number;
  netMinutes: number;
  overtimeMinutes: number;
  remainingMinutes: number;
  status: VehicleStatus;
  mealAlert: boolean;
  interjournadaAlert: "none" | "warning" | "critical";
  interjournadaMinutes: number | null;
}

export interface TimelineSegment {
  startMinute: number;
  endMinute: number;
  status: VehicleStatus | "interjornada" | "inactive";
  isPreviousDay: boolean;
  macro?: MacroNumber;
  journeyDate?: string;
}
