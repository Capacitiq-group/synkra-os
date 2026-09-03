import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { CustomersListPage } from "./pages/customers/CustomersList";
import { CustomerDetailPage } from "./pages/customers/CustomerDetail";
import { SupportTicketsPage } from "./pages/support/SupportTickets";
import { BillingPage } from "./pages/billing/Billing";
import { AgencyPipelinePage } from "./pages/agency/AgencyPipeline";
import { AgencyPlatformPage } from "./pages/agency-platform/AgencyPlatform";
import { AiEmployeesPage } from "./pages/ai-employees/AiEmployees";
import { InfrastructurePage } from "./pages/infrastructure/Infrastructure";
import { IncidentsPage } from "./pages/incidents/Incidents";
import { DeploymentsPage } from "./pages/deployments/Deployments";
import { UtilitiesPage } from "./pages/utilities/Utilities";
import { PartnersPage } from "./pages/partners/Partners";
import { AuditLogsPage } from "./pages/audit/AuditLogs";
import { SettingsPage } from "./pages/settings/Settings";
import { LeadsPage } from "./pages/leads/Leads";
import { FollowUpsPage } from "./pages/followups/FollowUps";
import { FlowPage } from "./pages/flow/Flow";
import { ChatPage } from "./pages/chat/Chat";
import { EmailPage } from "./pages/email/Email";
import { IntegrationsPage } from "./pages/integrations/Integrations";
import { AcquisitionEnginePage } from "./pages/acquisition/AcquisitionEngine";

function guarded(permission: string, element: JSX.Element) {
  return <ProtectedRoute permission={permission}>{element}</ProtectedRoute>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/leads" element={guarded("leads.view", <LeadsPage />)} />
            <Route path="/follow-ups" element={guarded("followups.view", <FollowUpsPage />)} />
            <Route path="/customers" element={guarded("customers.view", <CustomersListPage />)} />
            <Route path="/customers/:id" element={guarded("customers.view", <CustomerDetailPage />)} />
            <Route path="/support" element={guarded("support.view", <SupportTicketsPage />)} />
            <Route path="/billing" element={guarded("billing.view", <BillingPage />)} />
            <Route path="/agency" element={guarded("agency.view", <AgencyPipelinePage />)} />
            <Route path="/agency-platform" element={guarded("agency.view", <AgencyPlatformPage />)} />
            <Route path="/email" element={guarded("email.view", <EmailPage />)} />
            <Route path="/flow" element={guarded("flow.view", <FlowPage />)} />
            <Route path="/chat" element={guarded("chat.view", <ChatPage />)} />
            <Route path="/acquisition" element={guarded("acquisition.view", <AcquisitionEnginePage />)} />
            <Route path="/ai-employees" element={guarded("ai.view", <AiEmployeesPage />)} />
            <Route path="/infrastructure" element={guarded("infrastructure.view", <InfrastructurePage />)} />
            <Route path="/incidents" element={guarded("incidents.view", <IncidentsPage />)} />
            <Route path="/deployments" element={guarded("deployments.view", <DeploymentsPage />)} />
            <Route path="/utilities" element={guarded("utilities.view", <UtilitiesPage />)} />
            <Route path="/partners" element={guarded("partners.view", <PartnersPage />)} />
            <Route path="/audit-logs" element={guarded("audit.view", <AuditLogsPage />)} />
            <Route path="/integrations" element={guarded("integrations.view", <IntegrationsPage />)} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

