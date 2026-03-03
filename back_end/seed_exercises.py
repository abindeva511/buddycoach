"""
Seed exercises.db with muscle groups and exercises.
Run from back_end/ directory:
    python seed_exercises.py
"""
import os
import sys
import urllib.parse
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.models.exercise import MuscleGroupDB, ExerciseDB

EXERCISES_DB_PATH = os.path.join(os.path.dirname(__file__), "exercises.db")
engine = create_engine(f"sqlite:///{EXERCISES_DB_PATH}", connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine)
db = Session()

def yt_search(exercise_name: str) -> str:
    """YouTube search embed URL — always works, shows relevant tutorials."""
    q = urllib.parse.quote_plus(f"{exercise_name} exercise proper form tutorial")
    return f"https://www.youtube.com/embed?listType=search&list={q}"

EXERCISES = {
    "Chest": [
        ("Barbell",    "Barbell Bench Press"),
        ("Barbell",    "Incline Barbell Bench Press"),
        ("Barbell",    "Decline Barbell Bench Press"),
        ("Dumbbell",   "Dumbbell Chest Fly"),
        ("Dumbbell",   "Dumbbell Bench Press"),
        ("Dumbbell",   "Incline Dumbbell Press"),
        ("Cable",      "Cable Chest Fly"),
        ("Cable",      "Low Cable Crossover"),
        ("Bodyweight", "Push-Up"),
        ("Bodyweight", "Wide Push-Up"),
        ("Machine",    "Chest Press Machine"),
        ("Machine",    "Pec Deck Machine"),
    ],
    "Back": [
        ("Barbell",    "Barbell Deadlift"),
        ("Barbell",    "Barbell Bent-Over Row"),
        ("Barbell",    "T-Bar Row"),
        ("Dumbbell",   "Dumbbell Single-Arm Row"),
        ("Dumbbell",   "Dumbbell Pullover"),
        ("Cable",      "Cable Lat Pulldown"),
        ("Cable",      "Seated Cable Row"),
        ("Cable",      "Straight-Arm Pulldown"),
        ("Bodyweight", "Pull-Up"),
        ("Bodyweight", "Chin-Up"),
        ("Bodyweight", "Inverted Row"),
        ("Machine",    "Machine Row"),
    ],
    "Shoulders": [
        ("Barbell",    "Barbell Overhead Press"),
        ("Barbell",    "Behind-the-Neck Press"),
        ("Dumbbell",   "Dumbbell Shoulder Press"),
        ("Dumbbell",   "Lateral Raise"),
        ("Dumbbell",   "Front Raise"),
        ("Dumbbell",   "Rear Delt Fly"),
        ("Dumbbell",   "Arnold Press"),
        ("Cable",      "Cable Lateral Raise"),
        ("Cable",      "Face Pull"),
        ("Bodyweight", "Pike Push-Up"),
        ("Machine",    "Machine Shoulder Press"),
        ("Machine",    "Rear Delt Machine"),
    ],
    "Arms": [
        ("Barbell",    "Barbell Bicep Curl"),
        ("Barbell",    "Close-Grip Bench Press"),
        ("Barbell",    "EZ-Bar Curl"),
        ("Dumbbell",   "Dumbbell Bicep Curl"),
        ("Dumbbell",   "Hammer Curl"),
        ("Dumbbell",   "Dumbbell Concentration Curl"),
        ("Dumbbell",   "Overhead Tricep Extension"),
        ("Dumbbell",   "Tricep Kickback"),
        ("Cable",      "Cable Tricep Pushdown"),
        ("Cable",      "Cable Bicep Curl"),
        ("Bodyweight", "Tricep Dip"),
        ("Bodyweight", "Diamond Push-Up"),
        ("Machine",    "Bicep Curl Machine"),
    ],
    "Thighs": [
        ("Barbell",    "Barbell Back Squat"),
        ("Barbell",    "Barbell Front Squat"),
        ("Barbell",    "Barbell Lunge"),
        ("Barbell",    "Romanian Deadlift"),
        ("Dumbbell",   "Dumbbell Goblet Squat"),
        ("Dumbbell",   "Dumbbell Split Squat"),
        ("Dumbbell",   "Dumbbell Step-Up"),
        ("Bodyweight", "Air Squat"),
        ("Bodyweight", "Bodyweight Lunge"),
        ("Bodyweight", "Wall Sit"),
        ("Machine",    "Leg Press"),
        ("Machine",    "Leg Extension"),
        ("Machine",    "Leg Curl"),
    ],
    "Calves": [
        ("Barbell",    "Standing Barbell Calf Raise"),
        ("Dumbbell",   "Seated Dumbbell Calf Raise"),
        ("Bodyweight", "Standing Calf Raise"),
        ("Bodyweight", "Single-Leg Calf Raise"),
        ("Bodyweight", "Jump Rope"),
        ("Machine",    "Seated Calf Raise Machine"),
        ("Machine",    "Standing Calf Raise Machine"),
    ],
    "Waist": [
        ("Bodyweight", "Crunch"),
        ("Bodyweight", "Bicycle Crunch"),
        ("Bodyweight", "Plank"),
        ("Bodyweight", "Side Plank"),
        ("Bodyweight", "Leg Raise"),
        ("Bodyweight", "Mountain Climber"),
        ("Bodyweight", "Russian Twist"),
        ("Cable",      "Cable Woodchop"),
        ("Cable",      "Cable Crunch"),
        ("Machine",    "Ab Machine Crunch"),
        ("Dumbbell",   "Dumbbell Side Bend"),
    ],
    "Hips": [
        ("Barbell",    "Barbell Hip Thrust"),
        ("Barbell",    "Sumo Deadlift"),
        ("Dumbbell",   "Dumbbell Hip Thrust"),
        ("Dumbbell",   "Dumbbell Romanian Deadlift"),
        ("Bodyweight", "Glute Bridge"),
        ("Bodyweight", "Donkey Kick"),
        ("Bodyweight", "Hip Circle"),
        ("Bodyweight", "Fire Hydrant"),
        ("Cable",      "Cable Hip Abduction"),
        ("Cable",      "Cable Kickback"),
        ("Machine",    "Hip Abduction Machine"),
        ("Machine",    "Hip Adduction Machine"),
    ],
    "Forearms": [
        ("Barbell",    "Barbell Wrist Curl"),
        ("Barbell",    "Reverse Barbell Curl"),
        ("Dumbbell",   "Dumbbell Wrist Curl"),
        ("Dumbbell",   "Dumbbell Reverse Curl"),
        ("Bodyweight", "Dead Hang"),
        ("Bodyweight", "Farmer's Carry"),
        ("Cable",      "Cable Reverse Curl"),
    ],
    "Neck": [
        ("Bodyweight", "Neck Flexion"),
        ("Bodyweight", "Neck Extension"),
        ("Bodyweight", "Neck Lateral Flexion"),
        ("Bodyweight", "Neck Rotation"),
        ("Machine",    "Neck Machine"),
    ],
}

# Wipe and reseed
db.query(ExerciseDB).delete()
db.query(MuscleGroupDB).delete()
db.commit()

total = 0
for group_name, exercises in EXERCISES.items():
    mg = MuscleGroupDB(name=group_name)
    db.add(mg)
    db.flush()
    for equipment, name in exercises:
        db.add(ExerciseDB(
            muscle_group_id=mg.id,
            muscle_name=group_name,
            equipment_type=equipment,
            exercise_name=name,
            video_url=yt_search(name),
            exercise_url=f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(name + ' exercise tutorial')}",
        ))
        total += 1

db.commit()
db.close()
print(f"✅ Seeded {len(EXERCISES)} muscle groups, {total} exercises → {EXERCISES_DB_PATH}")
