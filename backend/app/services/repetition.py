import math
import re
from collections import Counter


def normalize_text(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def ngrams(value: str, size: int = 3) -> Counter[str]:
    words = normalize_text(value).split()
    return Counter(" ".join(words[index : index + size]) for index in range(len(words) - size + 1))


def cosine_similarity(left: str, right: str) -> float:
    a, b = ngrams(left), ngrams(right)
    if not a or not b:
        return 0
    dot = sum(a[key] * b.get(key, 0) for key in a)
    magnitude = math.sqrt(sum(value * value for value in a.values())) * math.sqrt(
        sum(value * value for value in b.values())
    )
    return min(max(dot / magnitude, 0.0), 1.0) if magnitude else 0


def maximum_similarity(value: str, previous_values: list[str]) -> float:
    return max((cosine_similarity(value, previous) for previous in previous_values), default=0)
