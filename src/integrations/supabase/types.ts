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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_calls: {
        Row: {
          action: string
          created_at: string
          duration_ms: number | null
          error_code: string | null
          id: string
          is_guest: boolean
          model: string
          session_id: string | null
          success: boolean
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          is_guest?: boolean
          model: string
          session_id?: string | null
          success: boolean
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          is_guest?: boolean
          model?: string
          session_id?: string | null
          success?: boolean
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          body_md: string
          cover_path: string | null
          created_at: string
          id: string
          meta_description_ka: string | null
          published: boolean
          published_at: string | null
          slug: string
          title_ka: string
          updated_at: string
        }
        Insert: {
          body_md?: string
          cover_path?: string | null
          created_at?: string
          id?: string
          meta_description_ka?: string | null
          published?: boolean
          published_at?: string | null
          slug: string
          title_ka: string
          updated_at?: string
        }
        Update: {
          body_md?: string
          cover_path?: string | null
          created_at?: string
          id?: string
          meta_description_ka?: string | null
          published?: boolean
          published_at?: string | null
          slug?: string
          title_ka?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_designs: {
        Row: {
          ai_generated: boolean | null
          ai_prompt: string | null
          category: string | null
          created_at: string | null
          default_color: string | null
          default_product_id: string | null
          description_en: string | null
          description_ka: string | null
          id: string
          is_featured: boolean | null
          is_published: boolean | null
          meta_description_en: string | null
          meta_description_ka: string | null
          order_count: number | null
          print_file_url: string
          published_at: string | null
          slug: string
          tags: string[] | null
          thumbnail_url: string | null
          title_en: string | null
          title_ka: string
          updated_at: string | null
          view_count: number | null
        }
        Insert: {
          ai_generated?: boolean | null
          ai_prompt?: string | null
          category?: string | null
          created_at?: string | null
          default_color?: string | null
          default_product_id?: string | null
          description_en?: string | null
          description_ka?: string | null
          id?: string
          is_featured?: boolean | null
          is_published?: boolean | null
          meta_description_en?: string | null
          meta_description_ka?: string | null
          order_count?: number | null
          print_file_url: string
          published_at?: string | null
          slug: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title_en?: string | null
          title_ka: string
          updated_at?: string | null
          view_count?: number | null
        }
        Update: {
          ai_generated?: boolean | null
          ai_prompt?: string | null
          category?: string | null
          created_at?: string | null
          default_color?: string | null
          default_product_id?: string | null
          description_en?: string | null
          description_ka?: string | null
          id?: string
          is_featured?: boolean | null
          is_published?: boolean | null
          meta_description_en?: string | null
          meta_description_ka?: string | null
          order_count?: number | null
          print_file_url?: string
          published_at?: string | null
          slug?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title_en?: string | null
          title_ka?: string
          updated_at?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_designs_default_product_id_fkey"
            columns: ["default_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_logs: {
        Row: {
          content: string
          created_at: string
          id: string
          image_path: string | null
          lang: string | null
          role: string
          session_id: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_path?: string | null
          lang?: string | null
          role: string
          session_id: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_path?: string | null
          lang?: string | null
          role?: string
          session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      composite_events: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          order_id: string | null
          session_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          order_id?: string | null
          session_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          order_id?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "composite_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_inquiries: {
        Row: {
          color: string | null
          comment: string | null
          company_name: string
          contact_person: string
          created_at: string
          email: string
          id: string
          logo_path: string | null
          logo_paths: string[] | null
          phone: string
          status: string
          tax_id: string
          tshirt_quantity: number
        }
        Insert: {
          color?: string | null
          comment?: string | null
          company_name: string
          contact_person: string
          created_at?: string
          email: string
          id?: string
          logo_path?: string | null
          logo_paths?: string[] | null
          phone: string
          status?: string
          tax_id: string
          tshirt_quantity: number
        }
        Update: {
          color?: string | null
          comment?: string | null
          company_name?: string
          contact_person?: string
          created_at?: string
          email?: string
          id?: string
          logo_path?: string | null
          logo_paths?: string[] | null
          phone?: string
          status?: string
          tax_id?: string
          tshirt_quantity?: number
        }
        Relationships: []
      }
      design_likes: {
        Row: {
          created_at: string
          design_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          design_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          design_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_likes_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "designs"
            referencedColumns: ["id"]
          },
        ]
      }
      designs: {
        Row: {
          color: string
          created_at: string
          id: string
          is_published: boolean
          likes_count: number
          mockup_image_path: string | null
          placement_scale: number
          placement_x: number
          placement_y: number
          product: string
          prompt: string | null
          title: string
          transparent_image_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          is_published?: boolean
          likes_count?: number
          mockup_image_path?: string | null
          placement_scale?: number
          placement_x?: number
          placement_y?: number
          product: string
          prompt?: string | null
          title?: string
          transparent_image_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_published?: boolean
          likes_count?: number
          mockup_image_path?: string | null
          placement_scale?: number
          placement_x?: number
          placement_y?: number
          product?: string
          prompt?: string | null
          title?: string
          transparent_image_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          email: string | null
          handled: boolean
          id: string
          message: string
          page: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          handled?: boolean
          id?: string
          message: string
          page?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          handled?: boolean
          id?: string
          message?: string
          page?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      generations: {
        Row: {
          color: string
          created_at: string
          id: string
          is_guest: boolean
          mockup_image_path: string | null
          product: string
          prompt: string | null
          session_id: string | null
          style: string | null
          transparent_image_path: string | null
          user_id: string | null
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          is_guest?: boolean
          mockup_image_path?: string | null
          product: string
          prompt?: string | null
          session_id?: string | null
          style?: string | null
          transparent_image_path?: string | null
          user_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_guest?: boolean
          mockup_image_path?: string | null
          product?: string
          prompt?: string | null
          session_id?: string | null
          style?: string | null
          transparent_image_path?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: {
          back_mockup_url: string | null
          back_transparent_image_url: string | null
          bog_order_id: string | null
          cart_id: string | null
          color: string | null
          comment: string | null
          created_at: string
          delivery_address: string | null
          delivery_price: number
          delivery_type: string
          design_state: Json | null
          email: string
          first_name: string
          front_mockup_url: string | null
          id: string
          is_studio: boolean
          last_name: string
          paid_at: string | null
          payment_provider: string
          payment_status: string
          phone: string
          product: string
          product_price: number
          prompt: string | null
          size: string | null
          status: string
          sub_product: string | null
          total_price: number
          transparent_image_url: string | null
          user_id: string | null
        }
        Insert: {
          back_mockup_url?: string | null
          back_transparent_image_url?: string | null
          bog_order_id?: string | null
          cart_id?: string | null
          color?: string | null
          comment?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_price?: number
          delivery_type?: string
          design_state?: Json | null
          email: string
          first_name: string
          front_mockup_url?: string | null
          id?: string
          is_studio?: boolean
          last_name: string
          paid_at?: string | null
          payment_provider?: string
          payment_status?: string
          phone?: string
          product: string
          product_price?: number
          prompt?: string | null
          size?: string | null
          status?: string
          sub_product?: string | null
          total_price?: number
          transparent_image_url?: string | null
          user_id?: string | null
        }
        Update: {
          back_mockup_url?: string | null
          back_transparent_image_url?: string | null
          bog_order_id?: string | null
          cart_id?: string | null
          color?: string | null
          comment?: string | null
          created_at?: string
          delivery_address?: string | null
          delivery_price?: number
          delivery_type?: string
          design_state?: Json | null
          email?: string
          first_name?: string
          front_mockup_url?: string | null
          id?: string
          is_studio?: boolean
          last_name?: string
          paid_at?: string | null
          payment_provider?: string
          payment_status?: string
          phone?: string
          product?: string
          product_price?: number
          prompt?: string | null
          size?: string | null
          status?: string
          sub_product?: string | null
          total_price?: number
          transparent_image_url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      partners: {
        Row: {
          active: boolean
          created_at: string
          id: string
          logo_path: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          logo_path: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          logo_path?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      portfolio_items: {
        Row: {
          active: boolean | null
          alt_text: string | null
          category: string | null
          created_at: string | null
          id: string
          image_path: string
          sort_order: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          alt_text?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          image_path: string
          sort_order?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          alt_text?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          image_path?: string
          sort_order?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          base_price: number | null
          colors: Json
          created_at: string | null
          description_en: string | null
          description_ka: string | null
          display_name_en: string | null
          display_name_ka: string
          display_order: number | null
          id: string
          is_active: boolean | null
          mockup_image_url: string | null
          print_area_height: number
          print_area_width: number
          print_area_x: number
          print_area_y: number
          quality: string
          sizes: string[] | null
          slug: string
          sub_product: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          base_price?: number | null
          colors?: Json
          created_at?: string | null
          description_en?: string | null
          description_ka?: string | null
          display_name_en?: string | null
          display_name_ka: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          mockup_image_url?: string | null
          print_area_height?: number
          print_area_width?: number
          print_area_x?: number
          print_area_y?: number
          quality?: string
          sizes?: string[] | null
          slug: string
          sub_product?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          base_price?: number | null
          colors?: Json
          created_at?: string | null
          description_en?: string | null
          description_ka?: string | null
          display_name_en?: string | null
          display_name_ka?: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          mockup_image_url?: string | null
          print_area_height?: number
          print_area_width?: number
          print_area_x?: number
          print_area_y?: number
          quality?: string
          sizes?: string[] | null
          slug?: string
          sub_product?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_anonymous: boolean | null
          is_blocked: boolean
          is_exempt: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_anonymous?: boolean | null
          is_blocked?: boolean
          is_exempt?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_anonymous?: boolean | null
          is_blocked?: boolean
          is_exempt?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit: {
        Row: {
          bucket_key: string
          created_at: string
          id: number
        }
        Insert: {
          bucket_key: string
          created_at?: string
          id?: never
        }
        Update: {
          bucket_key?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      showroom_photos: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          name: string | null
          photo_path: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string | null
          photo_path: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string | null
          photo_path?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_chat_messages: {
        Args: { p_session_id: string }
        Returns: {
          content: string
          created_at: string
          image_path: string
          lang: string
          role: string
        }[]
      }
      admin_list_chat_sessions: {
        Args: { p_limit: number; p_offset: number }
        Returns: {
          first_at: string
          last_at: string
          last_user_snippet: string
          message_count: number
          session_id: string
          user_email: string
          user_id: string
        }[]
      }
      admin_list_generations: {
        Args: { p_limit: number; p_offset: number }
        Returns: {
          color: string
          created_at: string
          id: string
          is_guest: boolean
          mockup_image_path: string
          product: string
          prompt: string
          session_id: string
          style: string
          transparent_image_path: string
          user_display_name: string
          user_email: string
          user_gen_count: number
          user_id: string
          user_paid_order_count: number
        }[]
      }
      admin_update_order: {
        Args: { p_field: string; p_order_id: string; p_value: string }
        Returns: Json
      }
      check_and_increment_rate_limit: {
        Args: { p_day_limit: number; p_hour_limit: number; p_key: string }
        Returns: boolean
      }
      check_generation_block: {
        Args: { p_action: string; p_user_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_generations_by_session: {
        Args: { p_session_id: string }
        Returns: {
          color: string
          created_at: string
          id: string
          mockup_image_path: string
          product: string
          prompt: string
          style: string
          transparent_image_path: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      report_brands: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avg_price: number
          bog_items: number
          bog_revenue: number
          brand: string
          other_items: number
          other_revenue: number
          tbc_items: number
          tbc_revenue: number
          total_items: number
          total_revenue: number
          type: string
        }[]
      }
      report_meta: {
        Args: { p_from: string; p_to: string }
        Returns: {
          total_orders: number
          unknown_providers: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
