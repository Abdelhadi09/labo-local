import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { exchangeOAuthCode } = useAuth();

  // Prevent duplicate execution in React StrictMode
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const exchange = async () => {
      const code = searchParams.get("code");

      if (!code) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        await exchangeOAuthCode(code);
        navigate("/", { replace: true });
      } catch (err) {
        console.error("OAuth exchange failed:", err);

        if (err.response) {
          console.error(err.response.data);
        }

        navigate("/login", { replace: true });
      }
    };

    exchange();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "var(--cream)",
      }}
    >
      <div
        style={{
          textAlign: "center",
          padding: "2rem",
          background: "white",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,.08)",
        }}
      >
        <h2>Connexion en cours…</h2>
        <p>Veuillez patienter.</p>
      </div>
    </div>
  );
}