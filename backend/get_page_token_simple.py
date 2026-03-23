#!/usr/bin/env python3
"""
Simple Page Access Token Getter
This script helps you get a Page Access Token using Graph API Explorer token.
"""

import httpx

def main():
    print("\n" + "="*60)
    print("Simple Page Access Token Helper")
    print("="*60)

    print("\nStep 1: Get a User Access Token from Graph API Explorer")
    print("-" * 60)
    print("1. Go to: https://developers.facebook.com/tools/explorer/")
    print("2. Select your app: Test-app")
    print("3. Add permissions: pages_show_list, pages_read_engagement")
    print("4. Click 'Generate Access Token'")
    print("5. Copy the token\n")

    user_token = input("Paste your User Access Token here: ").strip()

    if not user_token:
        print("No token provided. Exiting.")
        return

    print("\n\nStep 2: Fetching your Facebook Pages...")
    print("-" * 60)

    # Try to get pages with access_token field
    try:
        response = httpx.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={
                "access_token": user_token,
                "fields": "id,name,access_token"
            },
            timeout=30.0
        )

        if response.status_code == 200:
            data = response.json()
            pages = data.get("data", [])

            if pages and "access_token" in pages[0]:
                # Success! We got page tokens
                print(f"\n✅ Found {len(pages)} page(s) with access tokens:\n")

                for i, page in enumerate(pages, 1):
                    print(f"  {i}. {page['name']}")
                    print(f"     Page ID: {page['id']}")
                    print(f"     Page Token: {page['access_token'][:50]}...")

                # Show all pages
                print("\n" + "="*60)
                print("✅ SUCCESS! Found page tokens:")
                print("="*60)

                for page in pages:
                    print(f"\nPage: {page['name']}")
                    print(f"FACEBOOK_PAGE_ID={page['id']}")
                    print(f"FACEBOOK_PAGE_NAME={target_page['name']}")
                    print(f"FACEBOOK_PAGE_ACCESS_TOKEN={target_page['access_token']}")
                    print("\n" + "="*60)
                    return
            else:
                raise Exception("No access_token in response")

    except Exception as e:
        print(f"❌ Error getting pages: {e}")
    try:
        response = httpx.get(
            f"https://graph.facebook.com/v18.0/{page_id}",
            params={
                "access_token": user_token,
                "fields": "id,name"
            },
            timeout=30.0
        )

        if response.status_code == 200:
            page_data = response.json()
        else:
            error = response.json().get("error", {})

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
