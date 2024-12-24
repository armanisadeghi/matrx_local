async def handle_browser_event(data: dict):
    event_type = data.get("event_type")
    if event_type == "fetch_file_list":
        return {"files": ["example.txt", "data.csv"]}
    elif event_type == "take_screenshot":
        # Call your screenshot service here
        return {"status": "screenshot taken"}
    else:
        return {"error": "Unknown event"}
