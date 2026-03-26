import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardData } from "./useDashboardData";

export function useDriverHistory(driverSenha?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: ["driver-history", driverSenha, start, end],
    queryFn: async (): Promise<DashboardData> => {
      console.log(`[API] Buscando histórico do motorista (${driverSenha}) de ${start} a ${end}...`);
      
      const { data, error } = await supabase.functions.invoke("dashboard-api", {
        method: "GET",
        queryParams: { 
          driverSenha: driverSenha || "",
          start: start || "",
          end: end || ""
        }
      });

      if (error) {
        console.error("[API] Erro ao buscar histórico:", error);
        throw error;
      }

      return data as DashboardData;
    },
    enabled: !!driverSenha && !!start && !!end,
    staleTime: 5 * 60 * 1000, // 5 minutos (histórico muda pouco)
  });
}
