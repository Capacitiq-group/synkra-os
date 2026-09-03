export interface BaseRecord {
  id: string;
  created: string;
  updated: string;
}

export interface Permission extends BaseRecord {
  key: string;
  label: string;
  category: string;
}

export interface Role extends BaseRecord {
  name: string;
  is_super_admin: boolean;
  permissions: string[];
  expand?: { permissions?: Permission[] };
}

export interface Employee extends BaseRecord {
  full_name: string;
  email: string;
  role: string;
  department?: string;
  title?: string;
  status: "active" | "suspended" | "offboarded";
  expand?: { role?: Role };
}

export interface Customer extends BaseRecord {
  customer_code: string;
  name: string;
  email: string;
  phone?: string;
  country?: string;
  organisation?: string;
  customer_type: "saas" | "agency" | "utility_lead" | "partner_referred";
  account_status: "active" | "suspended" | "churned" | "pending_verification";
  assigned_staff?: string;
  signup_date?: string;
  notes?: string;
  flow_account_id?: string;
  chat_account_id?: string;
  zoho_contact_id?: string;
  expand?: { organisation?: { name: string }; assigned_staff?: Employee };
}

export interface Subscription extends BaseRecord {
  subscription_code: string;
  customer: string;
  product: string;
  plan_name?: string;
  status: "trialing" | "active" | "past_due" | "cancelled" | "paused";
  mrr_cents: number;
  currency?: string;
  current_period_end?: string;
  expand?: { product?: { name: string } };
}

export interface Invoice extends BaseRecord {
  invoice_number: string;
  customer: string;
  amount_cents: number;
  currency?: string;
  status: "draft" | "open" | "paid" | "failed" | "refunded" | "void";
  issued_at?: string;
  due_at?: string;
}

export interface Payment extends BaseRecord {
  customer: string;
  invoice?: string;
  amount_cents: number;
  currency?: string;
  status: "succeeded" | "failed" | "pending" | "refunded";
  provider?: string;
  paid_at?: string;
}

export interface SupportTicket extends BaseRecord {
  ticket_number: string;
  customer: string;
  subject: string;
  category?: string;
  priority: "low" | "medium" | "high" | "urgent";
  status:
    | "open"
    | "ai_investigating"
    | "waiting_on_customer"
    | "human_review"
    | "in_progress"
    | "resolved"
    | "closed";
  assignee?: string;
  ai_involved?: boolean;
  opened_at: string;
  resolved_at?: string;
  expand?: { customer?: Customer; assignee?: Employee };
}

export interface AuditLog extends BaseRecord {
  actor_employee: string;
  action: string;
  affected_collection?: string;
  affected_record_id?: string;
  affected_customer?: string;
  previous_value?: unknown;
  new_value?: unknown;
  reason?: string;
  occurred_at: string;
  expand?: { actor_employee?: Employee; affected_customer?: Customer };
}
