from uuid import NAMESPACE_URL, uuid5

from nexora.db import engine, one
from nexora.domain import Profile, make_event
from nexora.projections import outbox

FIXTURES = [
    ("Полярис Логистика", "ops@polaris.example.test"),
    ("Кварц Инжиниринг", "office@quartz.example.test"),
    ("Меридиан Снабжение", "orders@meridian.example.test"),
]


def seed():
    with engine().begin() as conn:
        for name, email in FIXTURES:
            identifier = uuid5(NAMESPACE_URL, "nexora-demo/" + email)
            record = one(
                conn,
                """INSERT INTO customers(id,name,email,version) VALUES (:id,:name,:email,1)
                               ON CONFLICT(id) DO NOTHING RETURNING id""",
                id=identifier,
                name=name,
                email=email,
            )
            if record:
                outbox(
                    conn,
                    make_event(
                        identifier, 1, Profile(name=name, email=email), identifier
                    ),
                )


if __name__ == "__main__":
    seed()
