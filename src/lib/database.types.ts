
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "acts": {
                  Row: {
                    "active": boolean,"cabinet_id": string,"category": string | null,"code": string | null,"created_at": string,"default_duration_minutes": number | null,"deleted_at": string | null,"id": string,"label": string,"price_gnf": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"cabinet_id": string,"category"?: string | null,"code"?: string | null,"created_at"?: string,"default_duration_minutes"?: number | null,"deleted_at"?: string | null,"id"?: string,"label": string,"price_gnf": number,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"cabinet_id"?: string,"category"?: string | null,"code"?: string | null,"created_at"?: string,"default_duration_minutes"?: number | null,"deleted_at"?: string | null,"id"?: string,"label"?: string,"price_gnf"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "acts_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"appointment_types": {
                  Row: {
                    "bookable_online": boolean,"cabinet_id": string,"color": string,"created_at": string,"deleted_at": string | null,"duration_minutes": number,"id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bookable_online"?: boolean,"cabinet_id": string,"color"?: string,"created_at"?: string,"deleted_at"?: string | null,"duration_minutes"?: number,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "bookable_online"?: boolean,"cabinet_id"?: string,"color"?: string,"created_at"?: string,"deleted_at"?: string | null,"duration_minutes"?: number,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_types_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "arrived_at": string | null,"cabinet_id": string,"chair_id": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"dentist_id": string,"ends_at": string,"id": string,"notes": string | null,"patient_id": string | null,"source": Database["public"]['Enums']["appointment_source"],"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"title": string | null,"type_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "arrived_at"?: string | null,"cabinet_id": string,"chair_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id": string,"ends_at": string,"id"?: string,"notes"?: string | null,"patient_id"?: string | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"title"?: string | null,"type_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "arrived_at"?: string | null,"cabinet_id"?: string,"chair_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id"?: string,"ends_at"?: string,"id"?: string,"notes"?: string | null,"patient_id"?: string | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"title"?: string | null,"type_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_chair_id_fkey"
      columns: ["chair_id"]
isOneToOne: false
      referencedRelation: "chairs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_type_id_fkey"
      columns: ["type_id"]
isOneToOne: false
      referencedRelation: "appointment_types"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"at": string,"cabinet_id": string | null,"id": number,"patient_id": string | null,"record_id": string | null,"table_name": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"at"?: string,"cabinet_id"?: string | null,"id"?: never,"patient_id"?: string | null,"record_id"?: string | null,"table_name": string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"at"?: string,"cabinet_id"?: string | null,"id"?: never,"patient_id"?: string | null,"record_id"?: string | null,"table_name"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"cabinet_counters": {
                  Row: {
                    "cabinet_id": string,"kind": string,"value": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"kind": string,"value"?: number,"year": number
                  }
                  Update: {
                    "cabinet_id"?: string,"kind"?: string,"value"?: number,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cabinet_counters_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"cabinets": {
                  Row: {
                    "address": string | null,"billing_cycle": Database["public"]['Enums']["billing_cycle"],"city": string | null,"country": string,"created_at": string,"currency": string,"current_period_end": string | null,"email": string | null,"id": string,"locale": string,"logo_path": string | null,"name": string,"online_booking_enabled": boolean,"online_cancel_min_hours": number,"opening_hours": NonNullable<Json>,"phone": string | null,"plan_id": string | null,"public_description": string | null,"public_page_enabled": boolean,"slug": string,"subscription_status": Database["public"]['Enums']["subscription_status"],"timezone": string,"trial_ends_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"billing_cycle"?: Database["public"]['Enums']["billing_cycle"],"city"?: string | null,"country"?: string,"created_at"?: string,"currency"?: string,"current_period_end"?: string | null,"email"?: string | null,"id"?: string,"locale"?: string,"logo_path"?: string | null,"name": string,"online_booking_enabled"?: boolean,"online_cancel_min_hours"?: number,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"plan_id"?: string | null,"public_description"?: string | null,"public_page_enabled"?: boolean,"slug": string,"subscription_status"?: Database["public"]['Enums']["subscription_status"],"timezone"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"billing_cycle"?: Database["public"]['Enums']["billing_cycle"],"city"?: string | null,"country"?: string,"created_at"?: string,"currency"?: string,"current_period_end"?: string | null,"email"?: string | null,"id"?: string,"locale"?: string,"logo_path"?: string | null,"name"?: string,"online_booking_enabled"?: boolean,"online_cancel_min_hours"?: number,"opening_hours"?: NonNullable<Json>,"phone"?: string | null,"plan_id"?: string | null,"public_description"?: string | null,"public_page_enabled"?: boolean,"slug"?: string,"subscription_status"?: Database["public"]['Enums']["subscription_status"],"timezone"?: string,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cabinets_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"chairs": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chairs_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"clinical_notes": {
                  Row: {
                    "appointment_id": string | null,"author_id": string,"body": string,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"patient_id": string,"signed_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"author_id": string,"body": string,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"patient_id": string,"signed_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"author_id"?: string,"body"?: string,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"patient_id"?: string,"signed_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinical_notes_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clinical_notes_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clinical_notes_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"kind": Database["public"]['Enums']["document_kind"],"mime_type": string | null,"patient_id": string,"shared_with_patient": boolean,"size_bytes": number | null,"storage_path": string,"title": string,"updated_at": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["document_kind"],"mime_type"?: string | null,"patient_id": string,"shared_with_patient"?: boolean,"size_bytes"?: number | null,"storage_path": string,"title": string,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["document_kind"],"mime_type"?: string | null,"patient_id"?: string,"shared_with_patient"?: boolean,"size_bytes"?: number | null,"storage_path"?: string,"title"?: string,"updated_at"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"cabinet_id": string,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"roles": (Database["public"]['Enums']["app_role"])[],"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"cabinet_id": string,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"roles": (Database["public"]['Enums']["app_role"])[],"token"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"cabinet_id"?: string,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"roles"?: (Database["public"]['Enums']["app_role"])[],"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_items": {
                  Row: {
                    "act_id": string | null,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"invoice_id": string,"label": string,"plan_item_id": string | null,"quantity": number,"sort_order": number,"tooth": number | null,"unit_price_gnf": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "act_id"?: string | null,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"invoice_id": string,"label": string,"plan_item_id"?: string | null,"quantity"?: number,"sort_order"?: number,"tooth"?: number | null,"unit_price_gnf": number,"updated_at"?: string
                  }
                  Update: {
                    "act_id"?: string | null,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"invoice_id"?: string,"label"?: string,"plan_item_id"?: string | null,"quantity"?: number,"sort_order"?: number,"tooth"?: number | null,"unit_price_gnf"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_items_act_id_fkey"
      columns: ["act_id"]
isOneToOne: false
      referencedRelation: "acts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_items_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_items_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_items_plan_item_id_fkey"
      columns: ["plan_item_id"]
isOneToOne: false
      referencedRelation: "treatment_plan_items"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"dentist_id": string | null,"due_date": string | null,"id": string,"issue_date": string,"notes": string | null,"number": string | null,"paid_gnf": number,"patient_id": string,"quote_id": string | null,"status": Database["public"]['Enums']["invoice_status"],"total_gnf": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id"?: string | null,"due_date"?: string | null,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string | null,"paid_gnf"?: number,"patient_id": string,"quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_gnf"?: number,"updated_at"?: string
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id"?: string | null,"due_date"?: string | null,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string | null,"paid_gnf"?: number,"patient_id"?: string,"quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_gnf"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "active": boolean,"cabinet_id": string,"color": string | null,"created_at": string,"deleted_at": string | null,"display_name": string | null,"id": string,"roles": (Database["public"]['Enums']["app_role"])[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"cabinet_id": string,"color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"roles": (Database["public"]['Enums']["app_role"])[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "active"?: boolean,"cabinet_id"?: string,"color"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"roles"?: (Database["public"]['Enums']["app_role"])[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"message_templates": {
                  Row: {
                    "body": string,"cabinet_id": string,"channel": Database["public"]['Enums']["message_channel"],"created_at": string,"deleted_at": string | null,"enabled": boolean,"id": string,"kind": Database["public"]['Enums']["message_kind"],"locale": string,"subject": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"cabinet_id": string,"channel": Database["public"]['Enums']["message_channel"],"created_at"?: string,"deleted_at"?: string | null,"enabled"?: boolean,"id"?: string,"kind": Database["public"]['Enums']["message_kind"],"locale"?: string,"subject"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"cabinet_id"?: string,"channel"?: Database["public"]['Enums']["message_channel"],"created_at"?: string,"deleted_at"?: string | null,"enabled"?: boolean,"id"?: string,"kind"?: Database["public"]['Enums']["message_kind"],"locale"?: string,"subject"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_templates_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_log": {
                  Row: {
                    "appointment_id": string | null,"cabinet_id": string,"channel": Database["public"]['Enums']["message_channel"],"created_at": string,"error": string | null,"id": string,"kind": Database["public"]['Enums']["message_kind"],"patient_id": string | null,"provider_message_id": string | null,"recipient": string,"sent_at": string | null,"status": Database["public"]['Enums']["message_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"cabinet_id": string,"channel": Database["public"]['Enums']["message_channel"],"created_at"?: string,"error"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["message_kind"],"patient_id"?: string | null,"provider_message_id"?: string | null,"recipient": string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"cabinet_id"?: string,"channel"?: Database["public"]['Enums']["message_channel"],"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["message_kind"],"patient_id"?: string | null,"provider_message_id"?: string | null,"recipient"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_log_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_log_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_log_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"patient_medical": {
                  Row: {
                    "alerts": (string)[],"allergies": string | null,"cabinet_id": string,"created_at": string,"current_treatments": string | null,"deleted_at": string | null,"medical_history": string | null,"patient_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alerts"?: (string)[],"allergies"?: string | null,"cabinet_id": string,"created_at"?: string,"current_treatments"?: string | null,"deleted_at"?: string | null,"medical_history"?: string | null,"patient_id": string,"updated_at"?: string
                  }
                  Update: {
                    "alerts"?: (string)[],"allergies"?: string | null,"cabinet_id"?: string,"created_at"?: string,"current_treatments"?: string | null,"deleted_at"?: string | null,"medical_history"?: string | null,"patient_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_medical_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_medical_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: true
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"patients": {
                  Row: {
                    "address": string | null,"admin_notes": string | null,"birth_date": string | null,"cabinet_id": string,"city": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"email": string | null,"emergency_contact_name": string | null,"emergency_contact_phone": string | null,"file_number": string | null,"first_name": string,"id": string,"insurance_name": string | null,"insurance_number": string | null,"last_name": string,"phone": string | null,"portal_user_id": string | null,"profession": string | null,"sex": Database["public"]['Enums']["sex"] | null,"updated_at": string,"whatsapp_opt_in": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"admin_notes"?: string | null,"birth_date"?: string | null,"cabinet_id": string,"city"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"emergency_contact_name"?: string | null,"emergency_contact_phone"?: string | null,"file_number"?: string | null,"first_name": string,"id"?: string,"insurance_name"?: string | null,"insurance_number"?: string | null,"last_name": string,"phone"?: string | null,"portal_user_id"?: string | null,"profession"?: string | null,"sex"?: Database["public"]['Enums']["sex"] | null,"updated_at"?: string,"whatsapp_opt_in"?: boolean
                  }
                  Update: {
                    "address"?: string | null,"admin_notes"?: string | null,"birth_date"?: string | null,"cabinet_id"?: string,"city"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"email"?: string | null,"emergency_contact_name"?: string | null,"emergency_contact_phone"?: string | null,"file_number"?: string | null,"first_name"?: string,"id"?: string,"insurance_name"?: string | null,"insurance_number"?: string | null,"last_name"?: string,"phone"?: string | null,"portal_user_id"?: string | null,"profession"?: string | null,"sex"?: Database["public"]['Enums']["sex"] | null,"updated_at"?: string,"whatsapp_opt_in"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "patients_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_installments": {
                  Row: {
                    "amount_gnf": number,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"due_date": string,"id": string,"invoice_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_gnf": number,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"due_date": string,"id"?: string,"invoice_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_gnf"?: number,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string,"id"?: string,"invoice_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_installments_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_installments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_transactions": {
                  Row: {
                    "amount_gnf": number,"cabinet_id": string,"created_at": string,"expires_at": string,"failure_reason": string | null,"id": string,"initiated_by": string | null,"invoice_id": string | null,"payer_phone": string,"provider": Database["public"]['Enums']["payment_provider"],"provider_reference": string | null,"purpose": Database["public"]['Enums']["payment_purpose"],"raw": Json | null,"status": Database["public"]['Enums']["payment_status"],"subscription_cycle": Database["public"]['Enums']["billing_cycle"] | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_gnf": number,"cabinet_id": string,"created_at"?: string,"expires_at"?: string,"failure_reason"?: string | null,"id"?: string,"initiated_by"?: string | null,"invoice_id"?: string | null,"payer_phone": string,"provider": Database["public"]['Enums']["payment_provider"],"provider_reference"?: string | null,"purpose": Database["public"]['Enums']["payment_purpose"],"raw"?: Json | null,"status"?: Database["public"]['Enums']["payment_status"],"subscription_cycle"?: Database["public"]['Enums']["billing_cycle"] | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_gnf"?: number,"cabinet_id"?: string,"created_at"?: string,"expires_at"?: string,"failure_reason"?: string | null,"id"?: string,"initiated_by"?: string | null,"invoice_id"?: string | null,"payer_phone"?: string,"provider"?: Database["public"]['Enums']["payment_provider"],"provider_reference"?: string | null,"purpose"?: Database["public"]['Enums']["payment_purpose"],"raw"?: Json | null,"status"?: Database["public"]['Enums']["payment_status"],"subscription_cycle"?: Database["public"]['Enums']["billing_cycle"] | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_transactions_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_transactions_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_gnf": number,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"notes": string | null,"paid_at": string,"received_by": string | null,"reference": string | null,"status": Database["public"]['Enums']["payment_status"],"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_gnf": number,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"notes"?: string | null,"paid_at"?: string,"received_by"?: string | null,"reference"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_gnf"?: number,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"paid_at"?: string,"received_by"?: string | null,"reference"?: string | null,"status"?: Database["public"]['Enums']["payment_status"],"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_transaction_id_fkey"
      columns: ["transaction_id"]
isOneToOne: true
      referencedRelation: "payment_transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "active": boolean,"code": string,"created_at": string,"id": string,"max_dentists": number | null,"min_dentists": number,"name": string,"price_monthly_gnf": number,"price_per_extra_dentist_gnf": number,"sort_order": number,"updated_at": string,"yearly_discount_pct": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"code": string,"created_at"?: string,"id"?: string,"max_dentists"?: number | null,"min_dentists": number,"name": string,"price_monthly_gnf": number,"price_per_extra_dentist_gnf"?: number,"sort_order"?: number,"updated_at"?: string,"yearly_discount_pct"?: number
                  }
                  Update: {
                    "active"?: boolean,"code"?: string,"created_at"?: string,"id"?: string,"max_dentists"?: number | null,"min_dentists"?: number,"name"?: string,"price_monthly_gnf"?: number,"price_per_extra_dentist_gnf"?: number,"sort_order"?: number,"updated_at"?: string,"yearly_discount_pct"?: number
                  }
                  Relationships: [
                    
                  ]
                },"practitioner_schedules": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"dentist_id": string,"end_time": string,"id": string,"start_time": string,"updated_at": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id": string,"end_time": string,"id"?: string,"start_time": string,"updated_at"?: string,"weekday": number
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id"?: string,"end_time"?: string,"id"?: string,"start_time"?: string,"updated_at"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "practitioner_schedules_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"prescriptions": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"dentist_id": string,"id": string,"issued_at": string,"items": NonNullable<Json>,"notes": string | null,"patient_id": string,"shared_with_patient": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id": string,"id"?: string,"issued_at"?: string,"items"?: NonNullable<Json>,"notes"?: string | null,"patient_id": string,"shared_with_patient"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id"?: string,"id"?: string,"issued_at"?: string,"items"?: NonNullable<Json>,"notes"?: string | null,"patient_id"?: string,"shared_with_patient"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prescriptions_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prescriptions_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"id": string,"is_platform_admin": boolean,"locale": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"id": string,"is_platform_admin"?: boolean,"locale"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"id"?: string,"is_platform_admin"?: boolean,"locale"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quote_items": {
                  Row: {
                    "act_id": string | null,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"label": string,"quantity": number,"quote_id": string,"sort_order": number,"tooth": number | null,"unit_price_gnf": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "act_id"?: string | null,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"label": string,"quantity"?: number,"quote_id": string,"sort_order"?: number,"tooth"?: number | null,"unit_price_gnf": number,"updated_at"?: string
                  }
                  Update: {
                    "act_id"?: string | null,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"label"?: string,"quantity"?: number,"quote_id"?: string,"sort_order"?: number,"tooth"?: number | null,"unit_price_gnf"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_act_id_fkey"
      columns: ["act_id"]
isOneToOne: false
      referencedRelation: "acts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "accepted_at": string | null,"cabinet_id": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"dentist_id": string | null,"id": string,"issue_date": string,"notes": string | null,"number": string | null,"patient_id": string,"plan_id": string | null,"status": Database["public"]['Enums']["quote_status"],"total_gnf": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"cabinet_id": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id"?: string | null,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string | null,"patient_id": string,"plan_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"total_gnf"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"cabinet_id"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"dentist_id"?: string | null,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string | null,"patient_id"?: string,"plan_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"total_gnf"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "treatment_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription_payments": {
                  Row: {
                    "amount_gnf": number,"cabinet_id": string,"created_at": string,"cycle": Database["public"]['Enums']["billing_cycle"],"dentist_count": number,"id": string,"period_end": string,"period_start": string,"plan_id": string | null,"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_gnf": number,"cabinet_id": string,"created_at"?: string,"cycle": Database["public"]['Enums']["billing_cycle"],"dentist_count": number,"id"?: string,"period_end": string,"period_start": string,"plan_id"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_gnf"?: number,"cabinet_id"?: string,"created_at"?: string,"cycle"?: Database["public"]['Enums']["billing_cycle"],"dentist_count"?: number,"id"?: string,"period_end"?: string,"period_start"?: string,"plan_id"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_payments_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscription_payments_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscription_payments_transaction_id_fkey"
      columns: ["transaction_id"]
isOneToOne: true
      referencedRelation: "payment_transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"time_off": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"dentist_id": string | null,"ends_at": string,"id": string,"reason": string | null,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id"?: string | null,"ends_at": string,"id"?: string,"reason"?: string | null,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id"?: string | null,"ends_at"?: string,"id"?: string,"reason"?: string | null,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_off_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    }
                  ]
                },"tooth_records": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"id": string,"notes": string | null,"patient_id": string,"status": Database["public"]['Enums']["tooth_status"],"surfaces": (string)[],"tooth": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"notes"?: string | null,"patient_id": string,"status"?: Database["public"]['Enums']["tooth_status"],"surfaces"?: (string)[],"tooth": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"id"?: string,"notes"?: string | null,"patient_id"?: string,"status"?: Database["public"]['Enums']["tooth_status"],"surfaces"?: (string)[],"tooth"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tooth_records_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tooth_records_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                },"treatment_plan_items": {
                  Row: {
                    "act_id": string | null,"cabinet_id": string,"created_at": string,"deleted_at": string | null,"done_at": string | null,"id": string,"label": string,"plan_id": string,"quantity": number,"status": Database["public"]['Enums']["plan_item_status"],"step": number,"tooth": number | null,"unit_price_gnf": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "act_id"?: string | null,"cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"done_at"?: string | null,"id"?: string,"label": string,"plan_id": string,"quantity"?: number,"status"?: Database["public"]['Enums']["plan_item_status"],"step"?: number,"tooth"?: number | null,"unit_price_gnf": number,"updated_at"?: string
                  }
                  Update: {
                    "act_id"?: string | null,"cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"done_at"?: string | null,"id"?: string,"label"?: string,"plan_id"?: string,"quantity"?: number,"status"?: Database["public"]['Enums']["plan_item_status"],"step"?: number,"tooth"?: number | null,"unit_price_gnf"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "treatment_plan_items_act_id_fkey"
      columns: ["act_id"]
isOneToOne: false
      referencedRelation: "acts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "treatment_plan_items_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "treatment_plan_items_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "treatment_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"treatment_plans": {
                  Row: {
                    "cabinet_id": string,"created_at": string,"deleted_at": string | null,"dentist_id": string,"id": string,"notes": string | null,"patient_id": string,"status": Database["public"]['Enums']["plan_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cabinet_id": string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id": string,"id"?: string,"notes"?: string | null,"patient_id": string,"status"?: Database["public"]['Enums']["plan_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "cabinet_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"dentist_id"?: string,"id"?: string,"notes"?: string | null,"patient_id"?: string,"status"?: Database["public"]['Enums']["plan_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "treatment_plans_cabinet_id_fkey"
      columns: ["cabinet_id"]
isOneToOne: false
      referencedRelation: "cabinets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "treatment_plans_patient_id_fkey"
      columns: ["patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"active_dentist_count":
{ Args: { "p_cabinet": string }; Returns: number
                           },
"create_cabinet":
{ Args: { "p_city"?: string,"p_is_dentist"?: boolean,"p_name": string,"p_phone"?: string,"p_slug": string }; Returns: string
                           },
"log_patient_view":
{ Args: { "p_patient": string }; Returns: undefined
                           },
"public_cabinet":
{ Args: { "p_slug": string }; Returns: Json
                           },
"subscription_price":
{ Args: { "p_cycle": Database["public"]['Enums']["billing_cycle"],"p_dentists": number }; Returns: {
              "amount_gnf": number,"plan_code": string,"plan_id": string
            }[]
                           }
          }
          Enums: {
            "app_role": "admin"|"dentist"|"assistant"|"accountant","appointment_source": "staff"|"online","appointment_status": "scheduled"|"confirmed"|"arrived"|"in_treatment"|"done"|"cancelled"|"no_show","billing_cycle": "monthly"|"yearly","document_kind": "xray"|"photo"|"prescription"|"scan"|"consent"|"administrative"|"other","invoice_status": "draft"|"issued"|"partially_paid"|"paid"|"cancelled","message_channel": "whatsapp"|"email"|"sms","message_kind": "reminder_day_before"|"reminder_same_day"|"booking_confirmation"|"otp","message_status": "queued"|"sent"|"delivered"|"read"|"failed","payment_method": "cash"|"orange_money"|"mtn_momo"|"transfer"|"other","payment_provider": "orange_money"|"mtn_momo","payment_purpose": "invoice"|"subscription","payment_status": "pending"|"succeeded"|"failed"|"expired"|"refunded","plan_item_status": "planned"|"done"|"cancelled","plan_status": "draft"|"proposed"|"accepted"|"in_progress"|"completed"|"cancelled","quote_status": "draft"|"sent"|"accepted"|"refused"|"expired","sex": "female"|"male"|"other","subscription_status": "trialing"|"active"|"past_due"|"expired"|"cancelled","tooth_status": "healthy"|"caries"|"filled"|"crown"|"missing"|"extracted"|"implant"|"root_canal"|"bridge"|"fractured"|"to_extract"|"other"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["admin", "dentist", "assistant", "accountant"],"appointment_source": ["staff", "online"],"appointment_status": ["scheduled", "confirmed", "arrived", "in_treatment", "done", "cancelled", "no_show"],"billing_cycle": ["monthly", "yearly"],"document_kind": ["xray", "photo", "prescription", "scan", "consent", "administrative", "other"],"invoice_status": ["draft", "issued", "partially_paid", "paid", "cancelled"],"message_channel": ["whatsapp", "email", "sms"],"message_kind": ["reminder_day_before", "reminder_same_day", "booking_confirmation", "otp"],"message_status": ["queued", "sent", "delivered", "read", "failed"],"payment_method": ["cash", "orange_money", "mtn_momo", "transfer", "other"],"payment_provider": ["orange_money", "mtn_momo"],"payment_purpose": ["invoice", "subscription"],"payment_status": ["pending", "succeeded", "failed", "expired", "refunded"],"plan_item_status": ["planned", "done", "cancelled"],"plan_status": ["draft", "proposed", "accepted", "in_progress", "completed", "cancelled"],"quote_status": ["draft", "sent", "accepted", "refused", "expired"],"sex": ["female", "male", "other"],"subscription_status": ["trialing", "active", "past_due", "expired", "cancelled"],"tooth_status": ["healthy", "caries", "filled", "crown", "missing", "extracted", "implant", "root_canal", "bridge", "fractured", "to_extract", "other"]
          }
        }
} as const
