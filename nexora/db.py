import os
from functools import lru_cache

from sqlalchemy import create_engine, text


@lru_cache
def engine():
    return create_engine(
        os.environ["DATABASE_URL"], pool_pre_ping=True, hide_parameters=True
    )


def run(conn, sql, **values):
    return conn.execute(text(sql), values)


def one(conn, sql, **values):
    row = run(conn, sql, **values).mappings().one_or_none()
    return dict(row) if row is not None else None


def rows(conn, sql, **values):
    return [dict(record) for record in run(conn, sql, **values).mappings()]
