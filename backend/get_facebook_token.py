#!/usr/bin/env python3
"""
Facebook Page Access Token Helper

This script helps you get a Page Access Token for your Facebook Page.
Run this from the backend directory where .env file is located.
"""

import os
import httpx
import webbrowser
from urllib.parse import urlencode
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Get credentials from environment
APP_ID = os.getenv("FACEBOOK_APP_ID")
APP_SECRET = os.getenv("FACEBOOK_APP_SECRET")

if not APP_ID or not APP_SECRET:
    print("Error: FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set in .env file")
    exit(1)

def main():
    print("\n" + "="*60)
    print("Facebook Page Access Token Helper")
    print("="*60)

    print("\nStep 1: Get a User Access Token")
    print("-" * 40)

    # Build the OAuth URL
    oauth_url = f"https://www.facebook.com/v18.0/dialog/oauth?" + urlencode({
        "client_id": APP_ID,
        "redirect_uri": "https://developers.facebook.com/tools/explorer/callback",
        "scope": "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata",
        "response_type": "token"
    })

    print("\nOpening Facebook authorization page...")
    print("Please authorize the app and you'll get a User Access Token.\n")

    webbrowser.open(oauth_url)

    print("After authorizing, you'll be redirected to a page with a token.")
    print("Copy the 'access_token' value from the URL.\n")

    user_token = input("Paste your User Access Token here: ").strip()

    if not user_token:
        print("No token provided. Exiting.")
        return

    print("\n\nStep 2: Fetching your Facebook Pages...")
    print("-" * 40)

    # Get user's pages
    response = httpx.get(
        "https://graph.facebook.com/v18.0/me/accounts",
        params={
            "access_token": user_token,
            "fields": "id,name,access_token"
        }
    )

    if response.status_code != 200:
        error = response.json().get("error", {})
        print(f"\nError: {error.get('message', 'Unknown error')}")
        return

    data = response.json()
    pages = data.get("data", [])

    if not pages:
        print("\nNo Facebook Pages found!")
        print("Make sure you have a Facebook Page and have granted page permissions.")
        return

    print(f"\nFound {len(pages)} page(s):\n")

    for i, page in enumerate(pages, 1):
        print(f"  {i}. {page['name']}")
        print(f"     Page ID: {page['id']}")

    # Select a page
    if len(pages) == 1:
        selected = pages[0]
    else:
        choice = input(f"\nSelect a page (1-{len(pages)}): ").strip()
        try:
            selected = pages[int(choice) - 1]
        except (ValueError, IndexError):
            print("Invalid selection. Using first page.")
            selected = pages[0]

    print("\n\nStep 3: Getting Long-Lived Page Token...")
    print("-" * 40)

    # Exchange for long-lived token
    response = httpx.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": APP_ID,
            "client_secret": APP_SECRET,
            "fb_exchange_token": user_token
        }
    )

    if response.status_code == 200:
        long_lived_user_token = response.json().get("access_token")

        # Get long-lived page token
        response = httpx.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={
                "access_token": long_lived_user_token,
                "fields": "id,name,access_token"
            }
        )

        if response.status_code == 200:
            pages = response.json().get("data", [])
            for page in pages:
                if page["id"] == selected["id"]:
                    selected = page
                    break

    print("\n" + "="*60)
    print("SUCCESS! Add these to your .env file:")
    print("="*60)
    print(f"\nFACEBOOK_PAGE_ID={selected['id']}")
    print(f"FACEBOOK_PAGE_NAME={selected['name']}")
    print(f"FACEBOOK_PAGE_ACCESS_TOKEN={selected['access_token']}")
    print("\n" + "="*60)

    # Also offer to update .env automatically
    update = input("\nWould you like me to update your .env file automatically? (y/n): ").strip().lower()

    if update == 'y':
        try:
            with open('.env', 'r') as f:
                env_content = f.read()

            # Update the values
            lines = env_content.split('\n')
            new_lines = []
            for line in lines:
                if line.startswith('FACEBOOK_PAGE_ID='):
                    new_lines.append(f"FACEBOOK_PAGE_ID={selected['id']}")
                elif line.startswith('FACEBOOK_PAGE_NAME='):
                    new_lines.append(f"FACEBOOK_PAGE_NAME={selected['name']}")
                elif line.startswith('FACEBOOK_PAGE_ACCESS_TOKEN='):
                    new_lines.append(f"FACEBOOK_PAGE_ACCESS_TOKEN={selected['access_token']}")
                else:
                    new_lines.append(line)

            with open('.env', 'w') as f:
                f.write('\n'.join(new_lines))

            print("\n.env file updated successfully!")
            print("Restart your backend server to apply changes.")
        except Exception as e:
            print(f"\nFailed to update .env: {e}")
            print("Please copy the values above manually.")

    print("\nDone! You can now use 'Quick Connect Facebook' in your app.")

if __name__ == "__main__":
    main()
