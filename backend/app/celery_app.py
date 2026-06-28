from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("autoclip", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)
celery_app.autodiscover_tasks(["app"])

