import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, AlertTriangle } from "lucide-react";

const LOGIN_TIMEOUT_MS = 15_000;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setServerError(false);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("TIMEOUT"))
          );
        }),
      ]);

      clearTimeout(timeout);

      if (error) {
        if (error.message?.includes("Invalid login") || error.message?.includes("invalid")) {
          toast.error("Credenciais inválidas. Verifique seu e-mail e senha.");
        } else {
          setServerError(true);
          toast.error("Erro ao conectar ao servidor. Tente novamente.");
        }
      } else {
        navigate("/", { replace: true });
      }
    } catch (err: any) {
      if (err?.message === "TIMEOUT") {
        setServerError(true);
        toast.error("Servidor indisponível. Tente novamente em alguns instantes.");
      } else {
        setServerError(true);
        toast.error("Erro inesperado. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="Jornada de Motorista" className="h-16" />
          <h1 className="text-2xl font-bold text-foreground">Controle de Jornada</h1>
          <p className="text-sm text-muted-foreground">Faça login para acessar o sistema</p>
        </div>

        {serverError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Servidor instável. Se o problema persistir, tente novamente em alguns minutos.</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 bg-card p-6 rounded-xl border shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            <LogIn className="h-4 w-4 mr-2" />
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Acesso restrito a usuários autorizados.
        </p>
      </div>
    </div>
  );
}
