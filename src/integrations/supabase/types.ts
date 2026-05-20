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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          canvas_url: string | null
          content: string | null
          course_id: number | null
          created_at: string | null
          id: string
          posted_at: string | null
          scheduled_post: string | null
          status: string | null
          subject: string | null
          title: string | null
          type: string | null
          updated_at: string
          week_id: string | null
        }
        Insert: {
          canvas_url?: string | null
          content?: string | null
          course_id?: number | null
          created_at?: string | null
          id?: string
          posted_at?: string | null
          scheduled_post?: string | null
          status?: string | null
          subject?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          canvas_url?: string | null
          content?: string | null
          course_id?: number | null
          created_at?: string | null
          id?: string
          posted_at?: string | null
          scheduled_post?: string | null
          status?: string | null
          subject?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_pacing_master: {
        Row: {
          at_home: string | null
          created_at: string
          day: string
          id: string
          in_class: string | null
          lesson_num: string | null
          notes: string | null
          quarter: string
          school_year: string
          subject: string
          type: string | null
          updated_at: string
          week_num: number
        }
        Insert: {
          at_home?: string | null
          created_at?: string
          day: string
          id?: string
          in_class?: string | null
          lesson_num?: string | null
          notes?: string | null
          quarter: string
          school_year?: string
          subject: string
          type?: string | null
          updated_at?: string
          week_num: number
        }
        Update: {
          at_home?: string | null
          created_at?: string
          day?: string
          id?: string
          in_class?: string | null
          lesson_num?: string | null
          notes?: string | null
          quarter?: string
          school_year?: string
          subject?: string
          type?: string | null
          updated_at?: string
          week_num?: number
        }
        Relationships: []
      }
      automation_jobs: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          job_name: string
          last_result: Json | null
          last_run: string | null
          next_run: string | null
          retry_count: number
          schedule: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          job_name: string
          last_result?: Json | null
          last_run?: string | null
          next_run?: string | null
          retry_count?: number
          schedule?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          job_name?: string
          last_result?: Json | null
          last_run?: string | null
          next_run?: string | null
          retry_count?: number
          schedule?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      canvas_orphan_files: {
        Row: {
          ai_lesson_ref: string | null
          ai_suggested_folder: string | null
          ai_suggested_name: string | null
          canvas_file_id: string
          canvas_url: string | null
          course_id: string | null
          created_at: string
          original_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_lesson_ref?: string | null
          ai_suggested_folder?: string | null
          ai_suggested_name?: string | null
          canvas_file_id: string
          canvas_url?: string | null
          course_id?: string | null
          created_at?: string
          original_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_lesson_ref?: string | null
          ai_suggested_folder?: string | null
          ai_suggested_name?: string | null
          canvas_file_id?: string
          canvas_url?: string | null
          course_id?: string | null
          created_at?: string
          original_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      canvas_patterns: {
        Row: {
          confidence: number
          created_at: string
          id: string
          occurrence_count: number
          pattern_key: string
          pattern_type: string
          pattern_value: Json
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          id?: string
          occurrence_count?: number
          pattern_key: string
          pattern_type: string
          pattern_value?: Json
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          id?: string
          occurrence_count?: number
          pattern_key?: string
          pattern_type?: string
          pattern_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      canvas_snapshots: {
        Row: {
          body: string | null
          canvas_id: string
          content_type: string
          course_id: number
          created_at: string
          id: string
          metadata: Json
          title: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          canvas_id: string
          content_type: string
          course_id: number
          created_at?: string
          id?: string
          metadata?: Json
          title?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          canvas_id?: string
          content_type?: string
          course_id?: number
          created_at?: string
          id?: string
          metadata?: Json
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      content_map: {
        Row: {
          auto_linked: boolean
          canonical_name: string | null
          canvas_file_id: string | null
          canvas_url: string | null
          confidence: string | null
          created_at: string | null
          id: string
          last_synced: string | null
          lesson_ref: string
          slug: string | null
          subject: string
          type: string | null
          updated_at: string
        }
        Insert: {
          auto_linked?: boolean
          canonical_name?: string | null
          canvas_file_id?: string | null
          canvas_url?: string | null
          confidence?: string | null
          created_at?: string | null
          id?: string
          last_synced?: string | null
          lesson_ref: string
          slug?: string | null
          subject: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          auto_linked?: boolean
          canonical_name?: string | null
          canvas_file_id?: string | null
          canvas_url?: string | null
          confidence?: string | null
          created_at?: string | null
          id?: string
          last_synced?: string | null
          lesson_ref?: string
          slug?: string | null
          subject?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      content_map_registry: {
        Row: {
          created_at: string
          date_string: string
          id: string
          last_scanned: string
          row_number: number
          sheet_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_string: string
          id?: string
          last_scanned?: string
          row_number: number
          sheet_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_string?: string
          id?: string
          last_scanned?: string
          row_number?: number
          sheet_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      deploy_log: {
        Row: {
          action: string | null
          canvas_url: string | null
          created_at: string | null
          id: string
          message: string | null
          payload: Json | null
          status: string | null
          subject: string | null
          week_id: string | null
        }
        Insert: {
          action?: string | null
          canvas_url?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          status?: string | null
          subject?: string | null
          week_id?: string | null
        }
        Update: {
          action?: string | null
          canvas_url?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          status?: string | null
          subject?: string | null
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deploy_log_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      deploy_logs: {
        Row: {
          created_at: string
          id: string
          message: string | null
          status: string
          subject: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          status: string
          subject?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          status?: string
          subject?: string | null
          type?: string
        }
        Relationships: []
      }
      deploy_notifications: {
        Row: {
          created_at: string
          entity_ref: string | null
          id: string
          level: string
          message: string | null
          read: boolean
          title: string
        }
        Insert: {
          created_at?: string
          entity_ref?: string | null
          id?: string
          level?: string
          message?: string | null
          read?: boolean
          title: string
        }
        Update: {
          created_at?: string
          entity_ref?: string | null
          id?: string
          level?: string
          message?: string | null
          read?: boolean
          title?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          canvas_url: string | null
          confidence: string | null
          created_at: string | null
          drive_file_id: string | null
          friendly_name: string | null
          id: string
          lesson_num: string | null
          needs_rename: boolean
          original_name: string | null
          renamed_at: string | null
          slug: string | null
          subject: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          canvas_url?: string | null
          confidence?: string | null
          created_at?: string | null
          drive_file_id?: string | null
          friendly_name?: string | null
          id?: string
          lesson_num?: string | null
          needs_rename?: boolean
          original_name?: string | null
          renamed_at?: string | null
          slug?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          canvas_url?: string | null
          confidence?: string | null
          created_at?: string | null
          drive_file_id?: string | null
          friendly_name?: string | null
          id?: string
          lesson_num?: string | null
          needs_rename?: boolean
          original_name?: string | null
          renamed_at?: string | null
          slug?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      learning_rules: {
        Row: {
          applied_count: number
          corrected_lesson: string | null
          corrected_subject: string | null
          corrected_type: string | null
          created_at: string
          id: string
          last_applied: string | null
          name_pattern: string | null
          original_name: string
          updated_at: string
        }
        Insert: {
          applied_count?: number
          corrected_lesson?: string | null
          corrected_subject?: string | null
          corrected_type?: string | null
          created_at?: string
          id?: string
          last_applied?: string | null
          name_pattern?: string | null
          original_name: string
          updated_at?: string
        }
        Update: {
          applied_count?: number
          corrected_lesson?: string | null
          corrected_subject?: string | null
          corrected_type?: string | null
          created_at?: string
          id?: string
          last_applied?: string | null
          name_pattern?: string | null
          original_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      newsletters: {
        Row: {
          birthdays: string | null
          created_at: string | null
          date_range: string | null
          extra_sections: Json | null
          footer_line: string | null
          homeroom_notes: string | null
          html_content: string | null
          id: string
          points_of_contact: Json
          posted_at: string | null
          quick_links: Json
          school_news: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          birthdays?: string | null
          created_at?: string | null
          date_range?: string | null
          extra_sections?: Json | null
          footer_line?: string | null
          homeroom_notes?: string | null
          html_content?: string | null
          id?: string
          points_of_contact?: Json
          posted_at?: string | null
          quick_links?: Json
          school_news?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          birthdays?: string | null
          created_at?: string | null
          date_range?: string | null
          extra_sections?: Json | null
          footer_line?: string | null
          homeroom_notes?: string | null
          html_content?: string | null
          id?: string
          points_of_contact?: Json
          posted_at?: string | null
          quick_links?: Json
          school_news?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pacing_rows: {
        Row: {
          at_home: string | null
          canvas_assignment_id: string | null
          canvas_url: string | null
          content_hash: string | null
          create_assign: boolean | null
          created_at: string | null
          day: string
          deploy_status: string | null
          hint_override: string | null
          id: string
          in_class: string | null
          is_synthetic: boolean
          last_deployed: string | null
          lesson_num: string | null
          object_id: string | null
          parent_row_id: string | null
          resources: string | null
          subject: string
          type: string | null
          updated_at: string
          week_id: string | null
        }
        Insert: {
          at_home?: string | null
          canvas_assignment_id?: string | null
          canvas_url?: string | null
          content_hash?: string | null
          create_assign?: boolean | null
          created_at?: string | null
          day: string
          deploy_status?: string | null
          hint_override?: string | null
          id?: string
          in_class?: string | null
          is_synthetic?: boolean
          last_deployed?: string | null
          lesson_num?: string | null
          object_id?: string | null
          parent_row_id?: string | null
          resources?: string | null
          subject: string
          type?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Update: {
          at_home?: string | null
          canvas_assignment_id?: string | null
          canvas_url?: string | null
          content_hash?: string | null
          create_assign?: boolean | null
          created_at?: string | null
          day?: string
          deploy_status?: string | null
          hint_override?: string | null
          id?: string
          in_class?: string | null
          is_synthetic?: boolean
          last_deployed?: string | null
          lesson_num?: string | null
          object_id?: string | null
          parent_row_id?: string | null
          resources?: string | null
          subject?: string
          type?: string | null
          updated_at?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pacing_rows_parent_row_id_fkey"
            columns: ["parent_row_id"]
            isOneToOne: false
            referencedRelation: "pacing_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pacing_rows_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      school_calendar: {
        Row: {
          affects_all: boolean
          cancels_instruction: boolean
          created_at: string
          date: string
          event_type: string
          id: string
          label: string
          school_year: string
        }
        Insert: {
          affects_all?: boolean
          cancels_instruction?: boolean
          created_at?: string
          date: string
          event_type: string
          id?: string
          label: string
          school_year?: string
        }
        Update: {
          affects_all?: boolean
          cancels_instruction?: boolean
          created_at?: string
          date?: string
          event_type?: string
          id?: string
          label?: string
          school_year?: string
        }
        Relationships: []
      }
      system_config: {
        Row: {
          assignment_prefixes: Json
          auto_logic: Json
          canvas_base_url: string | null
          course_ids: Json
          id: string
          power_up_map: Json
          quarter_colors: Json
          spelling_word_bank: Json
          updated_at: string | null
        }
        Insert: {
          assignment_prefixes?: Json
          auto_logic?: Json
          canvas_base_url?: string | null
          course_ids?: Json
          id?: string
          power_up_map?: Json
          quarter_colors?: Json
          spelling_word_bank?: Json
          updated_at?: string | null
        }
        Update: {
          assignment_prefixes?: Json
          auto_logic?: Json
          canvas_base_url?: string | null
          course_ids?: Json
          id?: string
          power_up_map?: Json
          quarter_colors?: Json
          spelling_word_bank?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      system_health_snapshots: {
        Row: {
          canvas_status: string | null
          created_at: string
          details: Json
          failed_deploys: number
          id: string
          orphan_files: number
          pending_assignments: number
          score: number
        }
        Insert: {
          canvas_status?: string | null
          created_at?: string
          details?: Json
          failed_deploys?: number
          id?: string
          orphan_files?: number
          pending_assignments?: number
          score?: number
        }
        Update: {
          canvas_status?: string | null
          created_at?: string
          details?: Json
          failed_deploys?: number
          id?: string
          orphan_files?: number
          pending_assignments?: number
          score?: number
        }
        Relationships: []
      }
      teacher_feedback_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          diff_summary: string | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          diff_summary?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          diff_summary?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      teacher_memory: {
        Row: {
          category: string
          confidence: number
          created_at: string
          id: string
          key: string
          last_used: string | null
          updated_at: string
          usage_count: number
          value: Json
        }
        Insert: {
          category: string
          confidence?: number
          created_at?: string
          id?: string
          key: string
          last_used?: string | null
          updated_at?: string
          usage_count?: number
          value?: Json
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          key?: string
          last_used?: string | null
          updated_at?: string
          usage_count?: number
          value?: Json
        }
        Relationships: []
      }
      teacher_patterns: {
        Row: {
          applied_count: number
          confidence: number
          created_at: string
          description: string | null
          id: string
          pattern_type: string
          rule: Json
          subject: string | null
          updated_at: string
        }
        Insert: {
          applied_count?: number
          confidence?: number
          created_at?: string
          description?: string | null
          id?: string
          pattern_type: string
          rule?: Json
          subject?: string | null
          updated_at?: string
        }
        Update: {
          applied_count?: number
          confidence?: number
          created_at?: string
          description?: string | null
          id?: string
          pattern_type?: string
          rule?: Json
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      weeks: {
        Row: {
          active_hs_subject: string | null
          created_at: string | null
          date_range: string | null
          id: string
          is_active: boolean
          page_hashes: Json
          quarter: string
          reminders: string | null
          resources: string | null
          subject_reminders: Json
          subject_resources: Json
          updated_at: string
          week_num: number
        }
        Insert: {
          active_hs_subject?: string | null
          created_at?: string | null
          date_range?: string | null
          id?: string
          is_active?: boolean
          page_hashes?: Json
          quarter: string
          reminders?: string | null
          resources?: string | null
          subject_reminders?: Json
          subject_resources?: Json
          updated_at?: string
          week_num: number
        }
        Update: {
          active_hs_subject?: string | null
          created_at?: string | null
          date_range?: string | null
          id?: string
          is_active?: boolean
          page_hashes?: Json
          quarter?: string
          reminders?: string | null
          resources?: string | null
          subject_reminders?: Json
          subject_resources?: Json
          updated_at?: string
          week_num?: number
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
