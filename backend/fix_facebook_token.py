#!/usr/bin/env python3
"""
Automated Facebook Token Fixer
This script converts your User token to a Page token automatically
"""

import httpx
import sys
from pathlib import Path

def load_env():
    """Load .env file as dictionary"""
    env_path = Path(__file__).parent / ".env"
    env_vars = {}

    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                env_vars[key] = value

    return env_vars, env_path

def save_env(env_vars, env_path):
    """Save updated .env file"""
    with open(env_path, 'w') as f:
        for key, value in env_vars.items():
            f.write(f"{key}={value}\n")

def main():
    print("\n" + "=" * 70)
    print("🔧 Facebook Token Auto-Fixer")
    print("=" * 70)

    # Load current .env
    print("\n📄 Loading .env file...")
    env_vars, env_path = load_env()

    current_token = env_vars.get('FACEBOOK_PAGE_ACCESS_TOKEN', '')
    page_id = env_vars.get('FACEBOOK_PAGE_ID', '')

    if not current_token:
        print("❌ Error: FACEBOOK_PAGE_ACCESS_TOKEN not found in .env")
        sys.exit(1)

    print(f"   Current token: {current_token[:30]}...")
    print(f"   Page ID: {page_id}")

    # Check if it's already a Page token
    print("\n🔍 Checking token type...")
    try:
        response = httpx.get(
            "https://graph.facebook.com/v18.0/debug_token",
            params={
                "input_token": current_token,
                "access_token": current_token
            },
            timeout=30.0
        )

        if response.status_code == 200:
            token_data = response.json().get('data', {})
            token_type = token_data.get('type', '')

            print(f"   Token type: {token_type}")

            if token_type == 'PAGE':
                print("\n✅ Token is already a Page token! Nothing to fix.")
                print("\n💡 If you're still getting errors, the issue might be:")
                print("   - Token expired (generate a new one)")
                print("   - Missing permissions")
                print("   - Page access restrictions")
                sys.exit(0)

            if token_type == 'USER':
                print("   ℹ️  Token is a User token, converting to Page token...")
            else:
                print(f"   ⚠️  Unexpected token type: {token_type}")

    except Exception as e:
        print(f"   ⚠️  Could not check token type: {e}")

    # Get Page Access Token
    print("\n🔄 Getting Page Access Token...")
    try:
        response = httpx.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={
                "fields": "id,name,access_token",
                "access_token": current_token
            },
            timeout=30.0
        )

        if response.status_code != 200:
            print(f"❌ Error: {response.status_code}")
            error_data = response.json()
            print(f"   {error_data.get('error', {}).get('message', 'Unknown error')}")

            if "token" in error_data.get('error', {}).get('message', '').lower():
                print("\n💡 Your User token is invalid or expired.")
                print("   1. Go to: https://developers.facebook.com/tools/explorer/")
                print("   2. Generate a new User Access Token")
                print("   3. Update FACEBOOK_PAGE_ACCESS_TOKEN in .env")
                print("   4. Run this script again")

            sys.exit(1)

        data = response.json()
        pages = data.get('data', [])

        if not pages:
            print("❌ No Facebook pages found for this user")
            print("\n💡 Make sure:")
            print("   - You manage at least one Facebook Page")
            print("   - The User token has 'pages_show_list' permission")
            sys.exit(1)

        # Find the correct page or use the first one
        target_page = None
        if page_id:
            for page in pages:
                if page['id'] == page_id:
                    target_page = page
                    break

        if not target_page:
            target_page = pages[0]

        page_token = target_page['access_token']
        page_name = target_page['name']
        page_id_found = target_page['id']

        print(f"✅ Found page: {page_name}")
        print(f"   Page ID: {page_id_found}")

        # Update .env
        print("\n💾 Updating .env file...")
        env_vars['FACEBOOK_PAGE_ID'] = page_id_found
        env_vars['FACEBOOK_PAGE_NAME'] = page_name
        env_vars['FACEBOOK_PAGE_ACCESS_TOKEN'] = page_token
        env_vars['INSTAGRAM_ACCESS_TOKEN'] = page_token

        # Write back to .env
        with open(env_path, 'w') as f:
            for line in open(env_path.parent / '.env').readlines():
                line = line.rstrip()
                if line.startswith('FACEBOOK_PAGE_ID='):
                    f.write(f"FACEBOOK_PAGE_ID={page_id_found}\n")
                elif line.startswith('FACEBOOK_PAGE_NAME='):
                    f.write(f"FACEBOOK_PAGE_NAME={page_name}\n")
                elif line.startswith('FACEBOOK_PAGE_ACCESS_TOKEN='):
                    f.write(f"FACEBOOK_PAGE_ACCESS_TOKEN={page_token}\n")
                elif line.startswith('INSTAGRAM_ACCESS_TOKEN='):
                    f.write(f"INSTAGRAM_ACCESS_TOKEN={page_token}\n")
                else:
                    f.write(line + "\n")

        print("✅ .env file updated!")

        # Test the new token
        print("\n🧪 Testing new token...")
        test_response = httpx.post(
            f"https://graph.facebook.com/v18.0/{page_id_found}/feed",
            data={
                "message": "Test post - please ignore",
                "access_token": page_token
            },
            timeout=30.0
        )

        if test_response.status_code == 200:
            post_data = test_response.json()
            print(f"✅ SUCCESS! Test post created: {post_data.get('id')}")
            print("\n" + "=" * 70)
            print("🎉 FIXED! Your token is now working!")
            print("=" * 70)
            print("\n📋 Next steps:")
            print("   1. Restart your backend server")
            print("   2. Try publishing a post from your app")
            print("   3. It should work now!")
        else:
            print(f"❌ Test post failed: {test_response.status_code}")
            print(f"   Error: {test_response.text}")
            print("\n💡 The token was updated but posting still fails.")
            print("   This might be due to:")
            print("   - Page permissions/restrictions")
            print("   - App review status")
            print("   - Rate limiting")

    except httpx.RequestError as e:
        print(f"❌ Network error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
