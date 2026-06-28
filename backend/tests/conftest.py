import os

os.environ["DATABASE_URL"] = "sqlite:///./test-autoclip.db"
os.environ["STORAGE_ROOT"] = "./test-storage"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"

