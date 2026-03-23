#!/usr/bin/env python3
"""
Instagram Business Account Credentials Helper

This script helps you get your Instagram Business Account ID and username.
You need:
1. A Facebook Page connected to an Instagram Business Account
2. A Page Access Token (from the Facebook setup)

Run this from the backend directory where .env file is located.
"""

import os
import httpx
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Get Facebook Page Access Token from environment
PAGE_TOKEN = os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN")
PAGE_ID = os.getenv("FACEBOOK_PAGE_ID")

if not PAGE_TOKEN or not PAGE_ID:
    print("Error: FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID must be set in .env file")
    print("Please run get_facebook_token.py first to set up your Facebook Page.")
    exit(1)

def main():
    print("\n" + "="*60)
    print("Instagram Business Account Credentials Helper")
    print("="*60)

    print("\nFetching Instagram Business Account from your Facebook Page...")
    print("-" * 40)

    # Get Instagram Business Account connected to the Facebook Page
    response = httpx.get(
        f"https://graph.facebook.com/v18.0/{PAGE_ID}",
        params={
            "access_token": PAGE_TOKEN,
            "fields": "instagram_business_account"
        }
    )

    if response.status_code != 200:
        error = response.json().get("error", {})
        print(f"\nError: {error.get('message', 'Unknown error')}")
        print("\nMake sure:")
        print("1. Your Facebook Page is connected to an Instagram Business Account")
        print("2. Your Page Access Token has the required permissions")
        print("3. Go to https://www.facebook.com/settings?tab=business_tools")
        print("   to connect your Instagram account to your Facebook Page")
        return

    data = response.json()

    if "instagram_business_account" not in data:
        print("\n❌ No Instagram Business Account found connected to this Facebook Page!")
        print("\nTo fix this:")
        print("1. Convert your Instagram account to a Business Account")
        print("2. Go to your Facebook Page settings")
        print("3. Navigate to 'Instagram' in the left menu")
        print("4. Click 'Connect Account' and log in to your Instagram")
        print("\nLearn more: https://help.instagram.com/502981923235522")
        return

    instagram_id = data["instagram_business_account"]["id"]

    # Get Instagram account details
    print(f"✅ Found Instagram Business Account: {instagram_id}")
    print("\nFetching account details...")

    ig_response = httpx.get(
        f"https://graph.facebook.com/v18.0/{instagram_id}",
        params={
            "access_token": PAGE_TOKEN,
            "fields": "id,username,name,profile_picture_url"
        }
    )

    if ig_response.status_code != 200:
        error = ig_response.json().get("error", {})
        print(f"\nError fetching Instagram details: {error.get('message', 'Unknown error')}")
        return

    ig_data = ig_response.json()

    print("\n" + "="*60)
    print("SUCCESS! Add these to your .env file:")
    print("="*60)
    print(f"\nINSTAGRAM_ACCOUNT_ID={ig_data['id']}")
    print(f"INSTAGRAM_USERNAME={ig_data.get('username', 'Unknown')}")
    print(f"INSTAGRAM_ACCESS_TOKEN={PAGE_TOKEN}")
    print("\n" + "="*60)

    print(f"\n📷 Instagram Account: @{ig_data.get('username', 'Unknown')}")
    print(f"   Name: {ig_data.get('name', 'N/A')}")
    print(f"   Account ID: {ig_data['id']}")

    # Offer to update .env automatically
    update = input("\nWould you like me to update your .env file automatically? (y/n): ").strip().lower()

    if update == 'y':
        try:
            with open('.env', 'r') as f:
                env_content = f.read()

            # Update the values
            lines = env_content.split('\n')

            # Check if Instagram variables exist
            has_ig_id = any(line.startswith('INSTAGRAM_ACCOUNT_ID=') for line in lines)
            has_ig_username = any(line.startswith('INSTAGRAM_USERNAME=') for line in lines)
            has_ig_token = any(line.startswith('INSTAGRAM_ACCESS_TOKEN=') for line in lines)

            new_lines = []
            for line in lines:
                if line.startswith('INSTAGRAM_ACCOUNT_ID='):
                    new_lines.append(f"INSTAGRAM_ACCOUNT_ID={ig_data['id']}")
                elif line.startswith('INSTAGRAM_USERNAME='):
                    new_lines.append(f"INSTAGRAM_USERNAME={ig_data.get('username', '')}")
                elif line.startswith('INSTAGRAM_ACCESS_TOKEN='):
                    new_lines.append(f"INSTAGRAM_ACCESS_TOKEN={PAGE_TOKEN}")
                else:
                    new_lines.append(line)

            # Add new variables if they don't exist
            if not has_ig_id or not has_ig_username or not has_ig_token:
                # Find the line with FACEBOOK_PAGE_ACCESS_TOKEN and add after it
                for i, line in enumerate(new_lines):
                    if line.startswith('FACEBOOK_PAGE_ACCESS_TOKEN='):
                        insert_lines = []
                        if not has_ig_id:
                            insert_lines.append('')
                            insert_lines.append('# Pre-configured Instagram Account (for Quick Connect without OAuth)')
                            insert_lines.append(f'INSTAGRAM_ACCOUNT_ID={ig_data["id"]}')
                        if not has_ig_username:
                            if not insert_lines:
                                insert_lines.append('')
                                insert_lines.append('# Pre-configured Instagram Account (for Quick Connect without OAuth)')
                            insert_lines.append(f'INSTAGRAM_USERNAME={ig_data.get("username", "")}')
                        if not has_ig_token:
                            if not insert_lines:
                                insert_lines.append('')
                                insert_lines.append('# Pre-configured Instagram Account (for Quick Connect without OAuth)')
                            insert_lines.append(f'INSTAGRAM_ACCESS_TOKEN={PAGE_TOKEN}')

                        new_lines = new_lines[:i+1] + insert_lines + new_lines[i+1:]
                        break

            with open('.env', 'w') as f:
                f.write('\n'.join(new_lines))

            print("\n✅ .env file updated successfully!")
            print("🔄 Restart your backend server to apply changes.")
        except Exception as e:
            print(f"\n❌ Failed to update .env: {e}")
            print("Please copy the values above manually.")

    print("\n✅ Done! You can now use 'Quick Connect Instagram' in your app.")
    print("\nNote: The Instagram access token is the same as your Facebook Page token")
    print("because Instagram Business API uses Facebook's authentication.")

if __name__ == "__main__":
    main()
