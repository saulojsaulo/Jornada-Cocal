

## Plan: Remove Landing Page from Root Route

**What changes:**

The root route (`/`) currently shows the landing page. We'll change it to redirect directly to the login page (or the control panel if already authenticated).

### Steps

1. **Update `src/App.tsx`**: Change the `/` route to redirect to `/controle/login` (or `/controle` which already handles auth via `ProtectedRoute`). Replace the `LandingPage` route with a `Navigate` redirect to `/controle`.

2. **Delete landing page files** (optional cleanup):
   - `src/pages/LandingPage.tsx`
   - All files in `src/components/landing/` (AnnouncementBar, Navbar, HeroSection, SocialProofSection, PainPointsSection, SolutionSection, HowItWorksSection, BenefitsSection, ResultsSection, ComplianceSection, SystemVisualSection, SimulatorSection, TestimonialsSection, TelemetrySection, FAQSection, CTASection, FooterSection, WhatsAppButton)
   - Any landing-specific assets (e.g., `src/assets/hero-fleet.jpg`, `src/assets/control-room.jpg`)

3. **Root behavior**: When users visit `/`, they'll be redirected to `/controle`. If not authenticated, `ProtectedRoute` will send them to `/controle/login`.

### Technical Detail

```tsx
// In App.tsx, replace:
<Route path="/" element={<LandingPage />} />
// With:
<Route path="/" element={<Navigate to="/controle" replace />} />
```

Remove the `LandingPage` lazy import and add `Navigate` from `react-router-dom`.

