import os
import json
from pathlib import Path

import firebase_admin
from firebase_admin import auth, credentials, firestore

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


def initialize_firebase():
    firebase_app = None
    try:
        firebase_app = firebase_admin.get_app()
    except ValueError:
        pass

    if firebase_app is not None:
        return firestore.client(app=firebase_app), auth

    credentials_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    credentials_json = os.getenv("FIREBASE_CREDENTIALS_JSON")

    if credentials_path:
        credentials_path = os.path.expanduser(credentials_path)

    def _path_exists(p):
        try:
            return p and os.path.exists(p)
        except Exception:
            return False

    if credentials_json:
        try:
            service_account_info = json.loads(credentials_json)
            cred = credentials.Certificate(service_account_info)
        except Exception as e:
            raise RuntimeError(f"FIREBASE_CREDENTIALS_JSON is set but could not be parsed: {e}")
    elif credentials_path:
        if not _path_exists(credentials_path):
            raise RuntimeError(
                f"FIREBASE_CREDENTIALS_PATH is set to '{credentials_path}' but the file was not found or is not readable.\n"
                "Ensure the file exists and the backend process has permission to read it."
            )
        cred = credentials.Certificate(credentials_path)
    else:
        raise RuntimeError(
            "Firebase credentials are not configured. Set FIREBASE_CREDENTIALS_PATH or FIREBASE_CREDENTIALS_JSON.\n"
            "For local dev you can put the service account JSON outside the repo and set FIREBASE_CREDENTIALS_PATH in .env or your shell."
        )

    firebase_admin.initialize_app(cred)
    return firestore.client(), auth


db, firebase_auth = initialize_firebase()
