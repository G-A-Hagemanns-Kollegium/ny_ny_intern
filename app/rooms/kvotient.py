"""Kvotient (room-lottery) ranking math (F-004).

Months are absolute, 0-indexed (decided): month_index(year, month) = year*12 + (month-1).
K = a*100/(a+b+12) where a = months lived at GAHK (minus orlov) and b = months until study end,
both relative to the target (offer) month. Confirmed formula (incl. the +12). Higher K ranks first.
"""


def month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)


def compute_k(
    move_in_index: int, done_studying_index: int, target_index: int, orlov_months: int = 0
) -> float:
    a = (target_index - move_in_index) - orlov_months
    b = done_studying_index - target_index
    denom = a + b + 12
    if denom <= 0:
        return 0.0
    return round(a * 100 / denom, 2)
