# requirements:
#   google-cloud-secret-manager>=2.20.0
#   python-dotenv>=1.0.1

import os
from google.cloud import secretmanager
from dotenv import dotenv_values

def upsert_secret(project_id: str, secret_id: str, value: str, labels: dict | None = None):
    client = secretmanager.SecretManagerServiceClient()
    parent = f"projects/{project_id}"
    name = f"{parent}/secrets/{secret_id}"

    # Create secret if missing
    try:
        client.get_secret(request={"name": name})
    except Exception:
        client.create_secret(
            request={
                "parent": parent,
                "secret_id": secret_id,
                "secret": {
                    "replication": {"automatic": {}},
                    "labels": labels or {},
                },
            }
        )

    # Add version
    client.add_secret_version(
        request={
            "parent": name,
            "payload": {"data": value.encode("utf-8")},
        }
    )

def sync_env_to_gsm(project_id: str, env_name: str, env_file: str, service: str = "app"):
    kv = dotenv_values(env_file)  # handles quotes / comments
    labels = {"env": env_name, "service": service, "managed-by": "scripts"}
    for key, val in kv.items():
        if val is None:
            continue
        secret_id = f"{service}__{env_name}__{key}"
        upsert_secret(project_id, secret_id, val, labels)
        print(f"Synced {secret_id}")

if __name__ == "__main__":
    # Example:
    #   export GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json
    #   python gsm_sync.py
    sync_env_to_gsm(
        project_id=os.environ["GCP_PROJECT_ID"],
        env_name=os.environ.get("ENV_NAME", "staging"),
        env_file=os.environ.get("ENV_FILE", ".env.staging"),
        service=os.environ.get("SERVICE_NAME", "lbp-react"),
    )
