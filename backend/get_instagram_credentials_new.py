#!/usr/bin/env python3
"""
Get Instagram Business Account credentials after connecting to Facebook Page.
Run this script after you've connected your Instagram Business Account to your Facebook Page.
"""

import httpx
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

PAGE_TOKEN = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
PAGE_ID = os.getenv("FACEBOOK_PAGE_ID")

if not PAGE_TOKEN or not PAGE_ID:
    print("❌ Error: FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID must be set in .env file")
    sys.exit(1)

def main():
    print("\n" + "=" * 70)
    print("Instagram Business Account Credential Fetcher")
    print("=" * 70)
    print("\nChecking if Instagram is connected to your Facebook Page...")
    print(f"Facebook Page ID: {PAGE_ID}")
    print(f"Facebook Page Name: Test Main Test\n")

    try:
        # Get Instagram account connected to the Facebook Page
        response = httpx.get(
            f"https://graph.facebook.com/v18.0/{PAGE_ID}",
            params={
                "fields": "instagram_business_account",
                "access_token": PAGE_TOKEN
            },
            timeout=30.0
        )

        if response.status_code != 200:
            print(f"❌ Error: {response.status_code}")
            print(response.text)
            sys.exit(1)

        data = response.json()

        if "instagram_business_account" not in data:
            print("❌ No Instagram Business Account connected to this Facebook Page.")
            print("\n📋 Next Steps:")
            print("1. Open Instagram app on your phone")
            print("2. Go to Settings → Account → Linked accounts → Facebook")
            print("3. Connect to Facebook Page: 'Test Main Test'")
            print("\nThen run this script again!")
            sys.exit(1)

        # Instagram account found!
        ig_account_id = data["instagram_business_account"]["id"]
        print(f"✅ Instagram account found: {ig_account_id}")

        # Get Instagram account details
        print("\nFetching Instagram account details...")
        ig_response = httpx.get(
            f"https://graph.facebook.com/v18.0/{ig_account_id}",
            params={
                "fields": "id,username,name,profile_picture_url",
                "access_token": PAGE_TOKEN
            },
            timeout=30.0
        )

        if ig_response.status_code != 200:
            print(f"❌ Error fetching Instagram details: {ig_response.status_code}")
            print(ig_response.text)
            sys.exit(1)

        ig_data = ig_response.json()

        print("\n" + "=" * 70)
        print("✅ SUCCESS! Instagram Business Account Found!")
        print("=" * 70)
        print(f"\nInstagram Username: @{ig_data.get('username', 'N/A')}")
        print(f"Instagram Name: {ig_data.get('name', 'N/A')}")
        print(f"Account ID: {ig_data['id']}")

        print("\n" + "=" * 70)
        print("📝 Add these to your .env file:")
        print("=" * 70)
        print(f"\nINSTAGRAM_ACCOUNT_ID={ig_data['id']}")
        print(f"INSTAGRAM_USERNAME={ig_data.get('username', '')}")
        print(f"INSTAGRAM_ACCESS_TOKEN={PAGE_TOKEN}")

        print("\n" + "=" * 70)
        print("✅ Copy the lines above and add them to:")
        print("   /Users/mac/Desktop/omnigenai/ai-marketing-platform/backend/.env")
        print("=" * 70)

    except httpx.RequestError as e:
        print(f"❌ Network error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
