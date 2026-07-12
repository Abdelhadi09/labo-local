import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      window.location.replace("/login?verified=false");
      return;
    }

    const apiBase =
      import.meta.env.VITE_API_URL || "http://localhost:5000/api";

    // Let the backend perform the verification.
    // The backend will then redirect back to the frontend.
    window.location.replace(
      `${apiBase}/auth/verify-email?token=${encodeURIComponent(token)}`
    );
  }, [searchParams]);

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
          background: "#fff",
          padding: "2rem",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,.08)",
          textAlign: "center",
        }}
      >
        <h2>Verification en cours…</h2>
        <p>Veuillez patienter.</p>
      </div>
    </div>
  );
}