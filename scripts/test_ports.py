import asyncio
from app.tools.session import ToolSession
from app.tools.tools.process_manager import tool_list_ports

async def main():
    res = await tool_list_ports(ToolSession("test"))
    print(res.output)
    print(f"Total metadata: {res.metadata.get('count')}")

if __name__ == "__main__":
    asyncio.run(main())
