#!/usr/bin/env python3
"""
Get Instagram credentials using the existing FACEBOOK_PAGE_ACCESS_TOKEN from .env
This script reads your .env file and uses the Facebook token to fetch Instagram details.
"""

import os
import httpx
import sys
from pathlib import Path

def load_env_value(key):
    """Load a value from .env file"""
    env_path = Path(__file__).parent / ".env"

    if not env_path.exists():
        print(f"❌ Error: .env file not found at {env_path}")
        sys.exit(1)

    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith(key + "="):
                value = line.split("=", 1)[1]
                return value

    return None

def main():
    print("\n" + "=" * 70)
    print("Instagram Credentials Fetcher")
    print("Using FACEBOOK_PAGE_ACCESS_TOKEN from .env")
    print("=" * 70)

    # Load values from .env
    page_id = load_env_value("FACEBOOK_PAGE_ID")
    page_name = load_env_value("FACEBOOK_PAGE_NAME")
    page_token = load_env_value("FACEBOOK_PAGE_ACCESS_TOKEN")

    if not page_id:
        print("❌ Error: FACEBOOK_PAGE_ID not found in .env")
        sys.exit(1)

    if not page_token:
        print("❌ Error: FACEBOOK_PAGE_ACCESS_TOKEN not found in .env")
        sys.exit(1)

    print(f"\n📄 Found in .env:")
    print(f"   Facebook Page ID: {page_id}")
    print(f"   Facebook Page Name: {page_name or 'Not set'}")
    print(f"   Token: {page_token[:30]}...")

    print(f"\n🔍 Checking for Instagram Business Account...")

    try:
        # Check if Instagram is connected
        response = httpx.get(
            f"https://graph.facebook.com/v18.0/{page_id}",
            params={
                "fields": "instagram_business_account",
                "access_token": page_token
            },
            timeout=30.0
        )

        if response.status_code != 200:
            print(f"\n❌ Error: {response.status_code}")
            error_data = response.json()
            print(f"   Message: {error_data.get('error', {}).get('message', 'Unknown error')}")

            if "token" in error_data.get('error', {}).get('message', '').lower():
                print("\n💡 Your token might be expired. Generate a new one:")
                print("   1. Go to: https://developers.facebook.com/tools/explorer/")
                print("   2. Generate a new User Access Token")
                print("   3. Run: ./refresh_tokens.sh")

            sys.exit(1)

        data = response.json()

        # Check if Instagram is connected
        if "instagram_business_account" not in data:
            print("\n❌ No Instagram Business Account connected to this Facebook Page.")
            print("\n📋 Next Steps:")
            print("   1. Open Instagram app on your phone")
            print("   2. Go to: Profile → ☰ Menu → Settings")
            print("   3. Tap: Account → Linked accounts → Facebook")
            print(f"   4. Connect to Facebook Page: '{page_name or page_id}'")
            print("\n   Then run this script again!")
            sys.exit(1)

        # Instagram found!
        ig_account_id = data["instagram_business_account"]["id"]
        print(f"✅ Found Instagram Business Account: {ig_account_id}")

        # Get Instagram details
        print(f"\n📱 Fetching Instagram account details...")

        ig_response = httpx.get(
            f"https://graph.facebook.com/v18.0/{ig_account_id}",
            params={
                "fields": "id,username,name,profile_picture_url",
                "access_token": page_token
            },
            timeout=30.0
        )

        if ig_response.status_code != 200:
            print(f"❌ Error fetching Instagram details: {ig_response.status_code}")
            print(ig_response.text)
            sys.exit(1)

        ig_data = ig_response.json()

        # Success!
        print("\n" + "=" * 70)
        print("✅ SUCCESS! Instagram Business Account Found!")
        print("=" * 70)

        print(f"\n📸 Instagram Details:")
        print(f"   Username: @{ig_data.get('username', 'N/A')}")
        print(f"   Name: {ig_data.get('name', 'N/A')}")
        print(f"   Account ID: {ig_data['id']}")

        print("\n" + "=" * 70)
        print("📝 ADD THESE LINES TO YOUR .env FILE:")
        print("=" * 70)
        print(f"\nINSTAGRAM_ACCOUNT_ID={ig_data['id']}")
        print(f"INSTAGRAM_USERNAME={ig_data.get('username', '')}")
        print(f"INSTAGRAM_ACCESS_TOKEN={page_token}")

        print("\n" + "=" * 70)
        print("💾 Copy the 3 lines above and add them to your .env file")
        print("=" * 70)

        print("\n✅ After updating .env:")
        print("   1. Restart your backend server")
        print("   2. Go to Settings in your app")
        print("   3. Click 'Quick Connect Instagram'")
        print("   4. Start publishing to Instagram!")

    except httpx.RequestError as e:
        print(f"\n❌ Network error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
