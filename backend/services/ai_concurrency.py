from contextlib import contextmanager
from threading import BoundedSemaphore

AI_MAX_CONCURRENT_CALLS = 3
AI_CALL_SEMAPHORE = BoundedSemaphore(AI_MAX_CONCURRENT_CALLS)

@contextmanager
def ai_call_slot():
    AI_CALL_SEMAPHORE.acquire()
    try:
        yield
    finally:
        AI_CALL_SEMAPHORE.release()
