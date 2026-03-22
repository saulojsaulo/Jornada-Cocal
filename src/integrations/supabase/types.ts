export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      autotrac_eventos: {
        Row: {
          account_number: number | null
          autotrac_id: number | null
          created_at: string
          id: string
          ignition: number | null
          landmark: string | null
          latitude: number | null
          longitude: number | null
          macro_number: number
          macro_version: number | null
          message_time: string
          position_time: string | null
          raw_data: Json | null
          vehicle_address: number | null
          vehicle_code: number
        }
        Insert: {
          account_number?: number | null
          autotrac_id?: number | null
          created_at?: string
          id?: string
          ignition?: number | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          macro_number: number
          macro_version?: number | null
          message_time: string
          position_time?: string | null
          raw_data?: Json | null
          vehicle_address?: number | null
          vehicle_code: number
        }
        Update: {
          account_number?: number | null
          autotrac_id?: number | null
          created_at?: string
          id?: string
          ignition?: number | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          macro_number?: number
          macro_version?: number | null
          message_time?: string
          position_time?: string | null
          raw_data?: Json | null
          vehicle_address?: number | null
          vehicle_code?: number
        }
        Relationships: []
      }
      autotrac_positions: {
        Row: {
          id: string
          ignition: number | null
          landmark: string | null
          latitude: number | null
          longitude: number | null
          position_time: string | null
          speed: number | null
          updated_at: string
          vehicle_code: number
        }
        Insert: {
          id?: string
          ignition?: number | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          position_time?: string | null
          speed?: number | null
          updated_at?: string
          vehicle_code: number
        }
        Update: {
          id?: string
          ignition?: number | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          position_time?: string | null
          speed?: number | null
          updated_at?: string
          vehicle_code?: number
        }
        Relationships: []
      }
      autotrac_vehicles: {
        Row: {
          account_code: number
          account_number: string | null
          created_at: string
          family_description: string | null
          id: string
          name: string
          plate: string | null
          updated_at: string
          vehicle_address: number | null
          vehicle_code: number
        }
        Insert: {
          account_code: number
          account_number?: string | null
          created_at?: string
          family_description?: string | null
          id?: string
          name: string
          plate?: string | null
          updated_at?: string
          vehicle_address?: number | null
          vehicle_code: number
        }
        Update: {
          account_code?: number
          account_number?: string | null
          created_at?: string
          family_description?: string | null
          id?: string
          name?: string
          plate?: string | null
          updated_at?: string
          vehicle_address?: number | null
          vehicle_code?: number
        }
        Relationships: []
      }
      cadastros: {
        Row: {
          ativo: boolean
          created_at: string
          gestor_id: string | null
          gestor_nome: string | null
          id: string
          motorista_id: string | null
          motorista_nome: string | null
          nome_veiculo: string
          numero_frota: string
          placa: string | null
          updated_at: string
          veiculo_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          gestor_id?: string | null
          gestor_nome?: string | null
          id?: string
          motorista_id?: string | null
          motorista_nome?: string | null
          nome_veiculo: string
          numero_frota: string
          placa?: string | null
          updated_at?: string
          veiculo_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          gestor_id?: string | null
          gestor_nome?: string | null
          id?: string
          motorista_id?: string | null
          motorista_nome?: string | null
          nome_veiculo?: string
          numero_frota?: string
          placa?: string | null
          updated_at?: string
          veiculo_id?: string
        }
        Relationships: []
      }
      gestores: {
        Row: {
          ativo: boolean
          created_at: string
          email: string | null
          external_id: string | null
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      macro_overrides: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          event_time: string | null
          id: string
          macro_number: number | null
          original_event_id: string | null
          original_event_time: string | null
          original_macro_number: number | null
          reason: string | null
          vehicle_code: number
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          event_time?: string | null
          id?: string
          macro_number?: number | null
          original_event_id?: string | null
          original_event_time?: string | null
          original_macro_number?: number | null
          reason?: string | null
          vehicle_code: number
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          event_time?: string | null
          id?: string
          macro_number?: number | null
          original_event_id?: string | null
          original_event_time?: string | null
          original_macro_number?: number | null
          reason?: string | null
          vehicle_code?: number
        }
        Relationships: []
      }
      motoristas: {
        Row: {
          ativo: boolean
          cpf: string | null
          created_at: string
          external_id: string | null
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cpf?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cpf?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      telemetria_sync: {
        Row: {
          created_at: string
          data_jornada: string
          distancia_km: number | null
          id: string
          pontos: Json
          synced_at: string
          total_raw: number | null
          updated_at: string
          vehicle_code: number
          veiculo_id: string | null
        }
        Insert: {
          created_at?: string
          data_jornada: string
          distancia_km?: number | null
          id?: string
          pontos?: Json
          synced_at?: string
          total_raw?: number | null
          updated_at?: string
          vehicle_code: number
          veiculo_id?: string | null
        }
        Update: {
          created_at?: string
          data_jornada?: string
          distancia_km?: number | null
          id?: string
          pontos?: Json
          synced_at?: string
          total_raw?: number | null
          updated_at?: string
          vehicle_code?: number
          veiculo_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
