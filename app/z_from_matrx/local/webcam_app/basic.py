import cv2


def find_available_cameras():
    index = 0
    available_cameras = []
    while True:
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)  # Using DirectShow for compatibility
        if not cap.read()[0]:
            cap.release()
            break
        else:
            available_cameras.append(index)
            print(f"[Matrix Webcam] Found webcam at index {index}.")
            cap.release()
        index += 1
    if not available_cameras:
        print("[Matrix Webcam] No available cameras found.")
    return available_cameras


def get_webcam_index(provided_index=None):
    available_cameras = find_available_cameras()

    if provided_index is not None:
        cap = cv2.VideoCapture(provided_index, cv2.CAP_DSHOW)
        if cap.isOpened():
            cap.release()
            print(f"[Matrix Webcam] Successfully opened camera with provided index {provided_index}.")
            return provided_index
        cap.release()
        print(f"[Matrix Webcam] Provided index {provided_index} is not available.")

    if available_cameras:
        print(f"[Matrix Webcam] Using camera with index {available_cameras[0]}.")
        return available_cameras[0]

    return None  # No cameras are available


if __name__ == "__main__":
    # Directly specify the index or let it default to None
    provided_index = 3
    get_webcam_index(provided_index)
