#!/usr/bin/env python3
"""
Feishu Push Message - Text Message Helper
Usage: python send_text.py <receive_id> <message> [receive_id_type]
Default receive_id_type: open_id
"""

import os
import sys
import json
import requests

def get_tenant_access_token():
    """Get tenant access token from Feishu"""
    app_id = os.environ.get("FEISHU_APP_ID")
    app_secret = os.environ.get("FEISHU_APP_SECRET")
    
    if not app_id or not app_secret:
        raise ValueError(
            "FEISHU_APP_ID and FEISHU_APP_SECRET environment variables must be set.\n"
            "Please set them before running this script."
        )
    
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    payload = {
        "app_id": app_id,
        "app_secret": app_secret
    }
    
    response = requests.post(url, json=payload)
    data = response.json()
    
    if data.get("code") != 0:
        raise Exception(f"Failed to get access token: [{data.get('code')}] {data.get('msg')}")
    
    return data["tenant_access_token"]

def send_message(
    receive_id: str, 
    content: str, 
    msg_type: str = "text", 
    receive_id_type: str = "open_id"
) -> dict:
    """Send message to Feishu user/group"""
    token = get_tenant_access_token()
    
    url = f"https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={receive_id_type}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8"
    }
    
    # Handle different message types
    if msg_type == "text":
        msg_content = json.dumps({"text": content})
    else:
        # For other types, content should already be JSON
        msg_content = content
    
    payload = {
        "receive_id": receive_id,
        "msg_type": msg_type,
        "content": msg_content
    }
    
    response = requests.post(url, json=payload, headers=headers)
    return response.json()

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        print(f"\nArguments received: {len(sys.argv) - 1}, expected at least 2")
        print("\nExample:")
        print("  python send_text.py ou_7999079c3251552c855725a3fd3a1deb \"Hello World!\"")
        print("  python send_text.py ou_7999079c3251552c855725a3fd3a1deb \"Hello\" open_id")
        sys.exit(1)
    
    receive_id = sys.argv[1]
    message = sys.argv[2]
    receive_id_type = sys.argv[3] if len(sys.argv) >= 4 else "open_id"
    
    try:
        result = send_message(
            receive_id=receive_id,
            content=message,
            msg_type="text",
            receive_id_type=receive_id_type
        )
        
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        if result.get("code") == 0:
            print(f"\n✅ Message sent successfully! Message ID: {result['data']['message_id']}")
        else:
            print(f"\n❌ Message failed: [{result.get('code')}] {result.get('msg')}")
            
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
