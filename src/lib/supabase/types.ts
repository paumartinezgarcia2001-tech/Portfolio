/**
 * Tipos de la base de datos. GENERADO: no lo edites a mano.
 * Se regenera con el MCP de Supabase o con:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      gigs: {
        Row: {
          city: string;
          created_at: string;
          event_date: string;
          id: string;
          lineup: string[];
          party_key: string | null;
          party_name: string | null;
          published: boolean;
          ticket_url: string | null;
          updated_at: string;
          updated_by: string | null;
          venue: string;
          venue_key: string | null;
        };
        Insert: {
          city: string;
          created_at?: string;
          event_date: string;
          id?: string;
          lineup?: string[];
          party_key?: string | null;
          party_name?: string | null;
          published?: boolean;
          ticket_url?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          venue: string;
          venue_key?: string | null;
        };
        Update: {
          city?: string;
          created_at?: string;
          event_date?: string;
          id?: string;
          lineup?: string[];
          party_key?: string | null;
          party_name?: string | null;
          published?: boolean;
          ticket_url?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          venue?: string;
          venue_key?: string | null;
        };
        Relationships: [];
      };
      mixes: {
        Row: {
          artwork_url: string | null;
          audio_url: string;
          created_at: string;
          duration_seconds: number | null;
          id: string;
          published: boolean;
          sort_order: number;
          subtitle: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          artwork_url?: string | null;
          audio_url: string;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          published?: boolean;
          sort_order?: number;
          subtitle?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          artwork_url?: string | null;
          audio_url?: string;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          published?: boolean;
          sort_order?: number;
          subtitle?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          id: number;
          info_markdown: string | null;
          ticker_append_next_gig: boolean;
          ticker_text: string;
          updated_at: string;
          updated_by: string | null;
          video: Json | null;
        };
        Insert: {
          id?: number;
          info_markdown?: string | null;
          ticker_append_next_gig?: boolean;
          ticker_text?: string;
          updated_at?: string;
          updated_by?: string | null;
          video?: Json | null;
        };
        Update: {
          id?: number;
          info_markdown?: string | null;
          ticker_append_next_gig?: boolean;
          ticker_text?: string;
          updated_at?: string;
          updated_by?: string | null;
          video?: Json | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
