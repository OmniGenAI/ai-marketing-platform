from supabase import create_client, Client

from app.config import settings


def get_supabase_admin_client() -> Client:
    """
    Get a Supabase client with service role key (admin access).
    Use this for server-side operations that need full access.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("Supabase URL and service role key must be configured")

    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY
    )


def get_supabase_anon_client() -> Client:
    """
    Get a Supabase client with anon key (public access).
    Use this for operations that respect RLS policies.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise ValueError("Supabase URL and anon key must be configured")

    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY
    )
