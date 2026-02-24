import cv2
import numpy as np
import base64
import os
import time
from config import TEMP_DIR
from matrx_utils import print_link

# DISABLED: deepface pulled in retina-face + mtcnn + TensorFlow (~1.6GB). Not in use.
# To restore: uncomment DeepFace import and analyze_face/recognize_face bodies, add deepface to deps

# You may need to install these additional libraries
import dlib
# from deepface import DeepFace

base_directory = f"{TEMP_DIR}/advanced_image_analysis"
image_directory = os.path.join(base_directory, "images")
video_directory = os.path.join(base_directory, "videos")


def ensure_directory(directory):
    os.makedirs(directory, exist_ok=True)


def get_webcam():
    for i in range(10):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            return cap
    raise Exception("No working webcam found")


def to_base64(file_path):
    with open(file_path, "rb") as file:
        return base64.b64encode(file.read()).decode('utf-8')


def from_base64(b64_string, output_path):
    with open(output_path, "wb") as file:
        file.write(base64.b64decode(b64_string))


def capture_image(webcam):
    ret, frame = webcam.read()
    if not ret:
        raise Exception("Failed to capture image")
    return frame


def save_image(image, prefix="image"):
    ensure_directory(image_directory)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    filename = os.path.join(image_directory, f"{prefix}_{timestamp}.jpg")
    cv2.imwrite(filename, image)
    return filename


def detect_faces(image):
    face_detector = dlib.get_frontal_face_detector()
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return face_detector(gray)


def get_facial_landmarks(image, face):
    predictor = dlib.shape_predictor("shape_predictor_68_face_landmarks.dat")
    shape = predictor(image, face)
    return [(shape.part(i).x, shape.part(i).y) for i in range(68)]


def analyze_face(image, face):
    # Disabled: required deepface (pulls TensorFlow)
    # x, y, w, h = (face.left(), face.top(), face.width(), face.height())
    # face_image = image[y:y + h, x:x + w]
    # analysis = DeepFace.analyze(face_image, actions=['age', 'gender', 'race', 'emotion'])
    return None


def recognize_face(image, face, known_faces_db):
    # Disabled: required deepface (pulls TensorFlow)
    # for name, known_face in known_faces_db.items():
    #     result = DeepFace.verify(face_image, known_face)
    #     if result['verified']: return name
    return "Unknown"


def detect_objects(image):
    net = cv2.dnn.readNet("yolov3.weights", "yolov3.cfg")
    layer_names = net.getLayerNames()
    output_layers = [layer_names[i - 1] for i in net.getUnconnectedOutLayers()]

    height, width, _ = image.shape
    blob = cv2.dnn.blobFromImage(image, 0.00392, (416, 416), (0, 0, 0), True, crop=False)
    net.setInput(blob)
    outs = net.forward(output_layers)

    class_ids = []
    confidences = []
    boxes = []

    for out in outs:
        for detection in out:
            scores = detection[5:]
            class_id = np.argmax(scores)
            confidence = scores[class_id]
            if confidence > 0.5:
                center_x = int(detection[0] * width)
                center_y = int(detection[1] * height)
                w = int(detection[2] * width)
                h = int(detection[3] * height)
                x = int(center_x - w / 2)
                y = int(center_y - h / 2)
                boxes.append([x, y, w, h])
                confidences.append(float(confidence))
                class_ids.append(class_id)

    indexes = cv2.dnn.NMSBoxes(boxes, confidences, 0.5, 0.4)

    with open("coco.names", "r") as f:
        classes = [line.strip() for line in f.readlines()]

    objects = []
    for i in range(len(boxes)):
        if i in indexes:
            label = str(classes[class_ids[i]])
            objects.append({
                'label': label,
                'confidence': confidences[i],
                'box': boxes[i]
            })

    return objects


def advanced_image_analysis(image_path, known_faces_db=None):
    image = cv2.imread(image_path)
    faces = detect_faces(image)

    analysis = {
        'faces': [],
        'objects': detect_objects(image)
    }

    for face in faces:
        landmarks = get_facial_landmarks(image, face)
        face_analysis = analyze_face(image, face)

        if known_faces_db:
            identity = recognize_face(image, face, known_faces_db)
        else:
            identity = None

        analysis['faces'].append({
            'bbox': (face.left(), face.top(), face.right(), face.bottom()),
            'landmarks': landmarks,
            'analysis': face_analysis,
            'identity': identity
        })

    return analysis


# Example usage
if __name__ == "__main__":
    try:
        webcam = get_webcam()

        # Capture and analyze a single image
        image = capture_image(webcam)
        image_path = save_image(image)
        print_link(image_path)

        # Convert to base64
        base64_image = to_base64(image_path)
        print(f"Base64 image (first 100 chars): {base64_image[:100]}...")

        # Perform advanced analysis
        analysis = advanced_image_analysis(image_path)
        print(f"Image analysis: {analysis}")

        webcam.release()
        cv2.destroyAllWindows()

    except Exception as e:
        print(e)
        print(f"An error occurred: {str(e)}")
