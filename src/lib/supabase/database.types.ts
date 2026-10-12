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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string
          created_by: string | null
          delayed_reported: boolean
          deleted_at: string | null
          deleted_batch: string | null
          deleted_by: string | null
          description: string | null
          duration_hours: number | null
          end_date: string | null
          est_cost: number | null
          id: string
          level: number
          name: string
          parent_id: string | null
          percent: number
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["activity_status"]
          updated_at: string
          version: number
          wbs_code: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delayed_reported?: boolean
          deleted_at?: string | null
          deleted_batch?: string | null
          deleted_by?: string | null
          description?: string | null
          duration_hours?: number | null
          end_date?: string | null
          est_cost?: number | null
          id?: string
          level: number
          name: string
          parent_id?: string | null
          percent?: number
          project_id: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          updated_at?: string
          version?: number
          wbs_code?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delayed_reported?: boolean
          deleted_at?: string | null
          deleted_batch?: string | null
          deleted_by?: string | null
          description?: string | null
          duration_hours?: number | null
          end_date?: string | null
          est_cost?: number | null
          id?: string
          level?: number
          name?: string
          parent_id?: string | null
          percent?: number
          project_id?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["activity_status"]
          updated_at?: string
          version?: number
          wbs_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_parent_fkey"
            columns: ["project_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          action: string
          activity_id: string | null
          activity_name: string | null
          actor_id: string | null
          actor_name: string | null
          client_id: string | null
          company_id: string | null
          entity_id: string | null
          entity_type: string
          field: string | null
          id: number
          is_escalation: boolean
          new_value: Json | null
          note: string | null
          observed_at: string | null
          old_value: Json | null
          project_id: string | null
          recorded_at: string
          summary: string | null
          via: string
          wbs_code: string | null
        }
        Insert: {
          action: string
          activity_id?: string | null
          activity_name?: string | null
          actor_id?: string | null
          actor_name?: string | null
          client_id?: string | null
          company_id?: string | null
          entity_id?: string | null
          entity_type: string
          field?: string | null
          id?: never
          is_escalation?: boolean
          new_value?: Json | null
          note?: string | null
          observed_at?: string | null
          old_value?: Json | null
          project_id?: string | null
          recorded_at?: string
          summary?: string | null
          via?: string
          wbs_code?: string | null
        }
        Update: {
          action?: string
          activity_id?: string | null
          activity_name?: string | null
          actor_id?: string | null
          actor_name?: string | null
          client_id?: string | null
          company_id?: string | null
          entity_id?: string | null
          entity_type?: string
          field?: string | null
          id?: never
          is_escalation?: boolean
          new_value?: Json | null
          note?: string | null
          observed_at?: string | null
          old_value?: Json | null
          project_id?: string | null
          recorded_at?: string
          summary?: string | null
          via?: string
          wbs_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_activities: {
        Row: {
          activity_id: string | null
          baseline_id: string
          cost: number | null
          created_at: string
          end_date: string | null
          hours: number | null
          id: string
          is_leaf: boolean
          level: number
          name: string
          parent_activity_id: string | null
          project_id: string
          start_date: string | null
          wbs_code: string
          weight: number | null
        }
        Insert: {
          activity_id?: string | null
          baseline_id: string
          cost?: number | null
          created_at?: string
          end_date?: string | null
          hours?: number | null
          id?: string
          is_leaf: boolean
          level: number
          name: string
          parent_activity_id?: string | null
          project_id: string
          start_date?: string | null
          wbs_code: string
          weight?: number | null
        }
        Update: {
          activity_id?: string | null
          baseline_id?: string
          cost?: number | null
          created_at?: string
          end_date?: string | null
          hours?: number | null
          id?: string
          is_leaf?: boolean
          level?: number
          name?: string
          parent_activity_id?: string | null
          project_id?: string
          start_date?: string | null
          wbs_code?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "baseline_activities_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_activities_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      baselines: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          project_id: string
          reason: string | null
          updated_at: string
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          project_id: string
          reason?: string | null
          updated_at?: string
          version_no: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          project_id?: string
          reason?: string | null
          updated_at?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "baselines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baselines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_dates: {
        Row: {
          created_at: string
          date: string
          id: string
          kind: Database["public"]["Enums"]["calendar_date_kind"]
          name: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          kind: Database["public"]["Enums"]["calendar_date_kind"]
          name?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          kind?: Database["public"]["Enums"]["calendar_date_kind"]
          name?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_dates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_dates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      calendars: {
        Row: {
          created_at: string
          holidays_nonworking: boolean
          hours_per_day: number
          project_id: string
          updated_at: string
          work_days: number[]
        }
        Insert: {
          created_at?: string
          holidays_nonworking?: boolean
          hours_per_day?: number
          project_id: string
          updated_at?: string
          work_days?: number[]
        }
        Update: {
          created_at?: string
          holidays_nonworking?: boolean
          hours_per_day?: number
          project_id?: string
          updated_at?: string
          work_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "calendars_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          default_hours_per_day: number
          default_work_days: number[]
          id: string
          name: string
          name_key: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_hours_per_day?: number
          default_work_days?: number[]
          id?: string
          name: string
          name_key?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_hours_per_day?: number
          default_work_days?: number[]
          id?: string
          name?: string
          name_key?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["company_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["company_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["company_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          project_id: string
          responded_at: string | null
          role: Database["public"]["Enums"]["project_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          project_id: string
          responded_at?: string | null
          role: Database["public"]["Enums"]["project_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          project_id?: string
          responded_at?: string | null
          role?: Database["public"]["Enums"]["project_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_code_attempts: {
        Row: {
          attempted_at: string
          id: number
          success: boolean
          user_id: string
        }
        Insert: {
          attempted_at?: string
          id?: never
          success: boolean
          user_id: string
        }
        Update: {
          attempted_at?: string
          id?: never
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_code_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          project_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          use_count: number
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          project_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          use_count?: number
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          project_id?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          company_id: string | null
          created_at: string
          email_attempts: number
          email_error: string | null
          email_status: string
          emailed_at: string | null
          id: string
          in_app: boolean
          link: string | null
          payload: Json
          project_id: string | null
          read_at: string | null
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          company_id?: string | null
          created_at?: string
          email_attempts?: number
          email_error?: string | null
          email_status?: string
          emailed_at?: string | null
          id?: string
          in_app?: boolean
          link?: string | null
          payload?: Json
          project_id?: string | null
          read_at?: string | null
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          company_id?: string | null
          created_at?: string
          email_attempts?: number
          email_error?: string | null
          email_status?: string
          emailed_at?: string | null
          id?: string
          in_app?: boolean
          link?: string | null
          payload?: Json
          project_id?: string | null
          read_at?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_holidays: {
        Row: {
          created_at: string
          date: string
          id: number
          name: string
          source: string
          type: string
          updated_at: string
          year: number | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: never
          name: string
          source: string
          type: string
          updated_at?: string
          year?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: never
          name?: string
          source?: string
          type?: string
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          duration_unit: Database["public"]["Enums"]["duration_unit"]
          email: string | null
          full_name: string | null
          id: string
          notification_prefs: Json
          onboarded_at: string | null
          role_pref: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          duration_unit?: Database["public"]["Enums"]["duration_unit"]
          email?: string | null
          full_name?: string | null
          id: string
          notification_prefs?: Json
          onboarded_at?: string | null
          role_pref?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          duration_unit?: Database["public"]["Enums"]["duration_unit"]
          email?: string | null
          full_name?: string | null
          id?: string
          notification_prefs?: Json
          onboarded_at?: string | null
          role_pref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        Insert: {
          budget: number
          budget_exceeded_notified_at?: string | null
          closed_at?: string | null
          color?: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at?: string
          created_by?: string | null
          delayed_notified_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          end_date: string
          id?: string
          is_archived?: boolean
          name: string
          name_key?: string | null
          near_budget_threshold?: number
          site_address?: string | null
          site_name?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["project_status"]
          status_reason?: string | null
          updated_at?: string
          version?: number
          weighting?: Database["public"]["Enums"]["weighting_basis"]
        }
        Update: {
          budget?: number
          budget_exceeded_notified_at?: string | null
          closed_at?: string | null
          color?: Database["public"]["Enums"]["project_color"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          delayed_notified_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          end_date?: string
          id?: string
          is_archived?: boolean
          name?: string
          name_key?: string | null
          near_budget_threshold?: number
          site_address?: string | null
          site_name?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["project_status"]
          status_reason?: string | null
          updated_at?: string
          version?: number
          weighting?: Database["public"]["Enums"]["weighting_basis"]
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_overview: {
        Row: {
          activity_count: number | null
          allocated: number | null
          budget: number | null
          budget_state: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"] | null
          company_id: string | null
          completed_count: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string | null
          is_archived: boolean | null
          is_delayed: boolean | null
          leaf_count: number | null
          my_company_role: Database["public"]["Enums"]["company_role"] | null
          my_project_role: Database["public"]["Enums"]["project_role"] | null
          name: string | null
          near_budget_threshold: number | null
          percent_complete: number | null
          remaining: number | null
          site_address: string | null
          site_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          status_reason: string | null
          unscheduled_count: number | null
          updated_at: string | null
          version: number | null
          weighting: Database["public"]["Enums"]["weighting_basis"] | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id?: string; p_token?: string }
        Returns: Json
      }
      activity_trash: {
        Args: { p_project_id: string }
        Returns: {
          activity_id: string
          batch_id: string
          deleted_at: string
          deleted_by: string
          deleted_by_name: string
          deliverables: number
          level: number
          name: string
          parent_deleted: boolean
          restore_until: string
          sub_deliverables: number
          total: number
          wbs_code: string
          work_packages: number
        }[]
      }
      add_project_member: {
        Args: {
          p_project_id: string
          p_role: Database["public"]["Enums"]["project_role"]
          p_user_id: string
        }
        Returns: {
          created_at: string
          id: string
          invited_by: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_schedule: {
        Args: { p_project_id: string; p_rows: Json }
        Returns: number
      }
      claim_email_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: string
          id: string
          link: string
          payload: Json
          recipient_email: string
          recipient_name: string
          title: string
          type: string
        }[]
      }
      company_name_available: { Args: { p_name: string }; Returns: boolean }
      complete_email: {
        Args: { p_error?: string; p_id: string; p_status: string }
        Returns: undefined
      }
      complete_profile: {
        Args: { p_full_name: string; p_role_pref: string }
        Returns: {
          avatar_url: string | null
          created_at: string
          duration_unit: Database["public"]["Enums"]["duration_unit"]
          email: string | null
          full_name: string | null
          id: string
          notification_prefs: Json
          onboarded_at: string | null
          role_pref: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_activity: {
        Args: {
          p_fields?: Json
          p_index?: number
          p_name: string
          p_parent_id: string
          p_project_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          delayed_reported: boolean
          deleted_at: string | null
          deleted_batch: string | null
          deleted_by: string | null
          description: string | null
          duration_hours: number | null
          end_date: string | null
          est_cost: number | null
          id: string
          level: number
          name: string
          parent_id: string | null
          percent: number
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["activity_status"]
          updated_at: string
          version: number
          wbs_code: string
        }
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_company: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          default_hours_per_day: number
          default_work_days: number[]
          id: string
          name: string
          name_key: string | null
          owner_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invite_code: {
        Args: {
          p_expires_in_days?: number
          p_max_uses?: number
          p_project_id?: string
        }
        Returns: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          project_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          use_count: number
        }
        SetofOptions: {
          from: "*"
          to: "invite_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project: {
        Args: {
          p_budget: number
          p_color?: Database["public"]["Enums"]["project_color"]
          p_description?: string
          p_end_date: string
          p_name: string
          p_site_address?: string
          p_site_name?: string
          p_start_date: string
        }
        Returns: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_invitation: {
        Args: { p_invitation_id?: string; p_token?: string }
        Returns: undefined
      }
      delete_activity: { Args: { p_activity_id: string }; Returns: Json }
      delete_project: { Args: { p_project_id: string }; Returns: Json }
      finish_onboarding_without_company: {
        Args: never
        Returns: {
          avatar_url: string | null
          created_at: string
          duration_unit: Database["public"]["Enums"]["duration_unit"]
          email: string | null
          full_name: string | null
          id: string
          notification_prefs: Json
          onboarded_at: string | null
          role_pref: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_invitation_by_token: { Args: { p_token: string }; Returns: Json }
      invite_to_project: {
        Args: {
          p_email: string
          p_project_id: string
          p_role: Database["public"]["Enums"]["project_role"]
        }
        Returns: Json
      }
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number }
      move_activity: {
        Args: {
          p_activity_id: string
          p_new_index?: number
          p_new_parent_id: string
        }
        Returns: Json
      }
      my_pending_invitations: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          expires_at: string
          id: string
          inviter_name: string
          project_id: string
          project_name: string
          role: Database["public"]["Enums"]["project_role"]
        }[]
      }
      notification_catalog: {
        Args: never
        Returns: {
          description: string
          email_default: boolean
          in_app_default: boolean
          label: string
          type: string
        }[]
      }
      preview_invite_code: { Args: { p_code: string }; Returns: Json }
      project_trash: {
        Args: never
        Returns: {
          color: Database["public"]["Enums"]["project_color"]
          deleted_at: string
          deleted_by: string
          deleted_by_name: string
          id: string
          name: string
          name_conflict: boolean
          restore_until: string
          status: Database["public"]["Enums"]["project_status"]
        }[]
      }
      redeem_invite_code: { Args: { p_code: string }; Returns: Json }
      remove_company_member: { Args: { p_user_id: string }; Returns: undefined }
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: undefined
      }
      rename_company: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          default_hours_per_day: number
          default_work_days: number[]
          id: string
          name: string
          name_key: string | null
          owner_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resend_invitation: { Args: { p_invitation_id: string }; Returns: Json }
      restore_activity: { Args: { p_batch_id: string }; Returns: Json }
      restore_project: {
        Args: { p_project_id: string }
        Returns: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      revoke_invite_code: {
        Args: { p_id: string }
        Returns: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          project_id: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          use_count: number
        }
        SetofOptions: {
          from: "*"
          to: "invite_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_daily_checks: { Args: never; Returns: Json }
      save_calendar: {
        Args: {
          p_dates: Json
          p_holidays_nonworking: boolean
          p_hours_per_day: number
          p_project_id: string
          p_schedule?: Json
          p_work_days: number[]
        }
        Returns: Json
      }
      set_company_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["company_role"]
          p_user_id: string
        }
        Returns: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["company_role"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "company_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_project_archived: {
        Args: { p_archived: boolean; p_project_id: string }
        Returns: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_project_status: {
        Args: {
          p_project_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["project_status"]
        }
        Returns: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_activity: {
        Args: {
          p_activity_id: string
          p_expected_version: number
          p_patch: Json
        }
        Returns: {
          created_at: string
          created_by: string | null
          delayed_reported: boolean
          deleted_at: string | null
          deleted_batch: string | null
          deleted_by: string | null
          description: string | null
          duration_hours: number | null
          end_date: string | null
          est_cost: number | null
          id: string
          level: number
          name: string
          parent_id: string | null
          percent: number
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["activity_status"]
          updated_at: string
          version: number
          wbs_code: string
        }
        SetofOptions: {
          from: "*"
          to: "activities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_company_defaults: {
        Args: { p_hours_per_day: number; p_work_days: number[] }
        Returns: {
          created_at: string
          default_hours_per_day: number
          default_work_days: number[]
          id: string
          name: string
          name_key: string | null
          owner_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_notification_prefs: { Args: { p_prefs: Json }; Returns: Json }
      update_profile: {
        Args: { p_patch: Json }
        Returns: {
          avatar_url: string | null
          created_at: string
          duration_unit: Database["public"]["Enums"]["duration_unit"]
          email: string | null
          full_name: string | null
          id: string
          notification_prefs: Json
          onboarded_at: string | null
          role_pref: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project: {
        Args: {
          p_expected_version: number
          p_patch: Json
          p_project_id: string
        }
        Returns: {
          budget: number
          budget_exceeded_notified_at: string | null
          closed_at: string | null
          color: Database["public"]["Enums"]["project_color"]
          company_id: string
          created_at: string
          created_by: string | null
          delayed_notified_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string
          id: string
          is_archived: boolean
          name: string
          name_key: string | null
          near_budget_threshold: number
          site_address: string | null
          site_name: string | null
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          status_reason: string | null
          updated_at: string
          version: number
          weighting: Database["public"]["Enums"]["weighting_basis"]
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      activity_status:
        | "not_started"
        | "ongoing"
        | "delayed"
        | "on_hold"
        | "completed"
      calendar_date_kind: "holiday" | "override_nonworking" | "override_working"
      company_role: "owner_pm" | "pm" | "inspector"
      duration_unit: "hours" | "days"
      invitation_status:
        | "pending"
        | "accepted"
        | "declined"
        | "expired"
        | "revoked"
      project_color: "blue" | "green" | "pink" | "purple" | "teal" | "graphite"
      project_role: "pm" | "inspector"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      weighting_basis: "cost" | "hours"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_status: [
        "not_started",
        "ongoing",
        "delayed",
        "on_hold",
        "completed",
      ],
      calendar_date_kind: [
        "holiday",
        "override_nonworking",
        "override_working",
      ],
      company_role: ["owner_pm", "pm", "inspector"],
      duration_unit: ["hours", "days"],
      invitation_status: [
        "pending",
        "accepted",
        "declined",
        "expired",
        "revoked",
      ],
      project_color: ["blue", "green", "pink", "purple", "teal", "graphite"],
      project_role: ["pm", "inspector"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      weighting_basis: ["cost", "hours"],
    },
  },
} as const
