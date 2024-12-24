import asyncpg

async def get_connection():
    return await asyncpg.connect(
        user="armani",
        password="ab1234",
        database="matrx_local",
        host="localhost"
    )
