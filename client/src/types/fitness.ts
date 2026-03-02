// ForgeFit Types

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface MuscleGroup {
  id: string;
  name: string;
  icon: string;
  exerciseCount: number;
  isPopular?: boolean;
  isWide?: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroupId: string;
  equipment: string;
  sets: number;
  reps: number;
  difficulty: Difficulty;
  description?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  fitnessLevel: Difficulty;
}

// Mock Data
export const muscleGroups: MuscleGroup[] = [
  { id: 'biceps', name: 'Biceps', icon: '💪', exerciseCount: 18 },
  { id: 'chest', name: 'Chest', icon: '🫁', exerciseCount: 24 },
  { id: 'legs', name: 'Legs', icon: '🦵', exerciseCount: 32 },
  { id: 'back', name: 'Back', icon: '🔙', exerciseCount: 28 },
  { id: 'shoulders', name: 'Shoulders', icon: '💀', exerciseCount: 16 },
  { id: 'core', name: 'Core', icon: '🧘', exerciseCount: 22 },
  { id: 'fullbody', name: 'Full Body', icon: '🤸', exerciseCount: 45, isPopular: true, isWide: true },
];

export const exercisesByMuscle: Record<string, Exercise[]> = {
  biceps: [
    { id: '1', name: 'Barbell Curl', muscleGroupId: 'biceps', equipment: 'Barbell', sets: 3, reps: 10, difficulty: 'Beginner' },
    { id: '2', name: 'Dumbbell Hammer Curl', muscleGroupId: 'biceps', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '3', name: 'Concentration Curl', muscleGroupId: 'biceps', equipment: 'Dumbbell', sets: 4, reps: 10, difficulty: 'Intermediate' },
    { id: '4', name: 'Cable Curl', muscleGroupId: 'biceps', equipment: 'Cable', sets: 4, reps: 12, difficulty: 'Intermediate' },
    { id: '5', name: 'Chin-Up', muscleGroupId: 'biceps', equipment: 'Bodyweight', sets: 3, reps: 8, difficulty: 'Advanced' },
    { id: '6', name: 'Preacher Curl', muscleGroupId: 'biceps', equipment: 'Barbell', sets: 3, reps: 10, difficulty: 'Intermediate' },
    { id: '7', name: 'Incline Dumbbell Curl', muscleGroupId: 'biceps', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Intermediate' },
    { id: '8', name: 'EZ Bar Curl', muscleGroupId: 'biceps', equipment: 'EZ Bar', sets: 3, reps: 10, difficulty: 'Beginner' },
  ],
  chest: [
    { id: '1', name: 'Bench Press', muscleGroupId: 'chest', equipment: 'Barbell', sets: 4, reps: 8, difficulty: 'Intermediate' },
    { id: '2', name: 'Push-Up', muscleGroupId: 'chest', equipment: 'Bodyweight', sets: 3, reps: 15, difficulty: 'Beginner' },
    { id: '3', name: 'Dumbbell Fly', muscleGroupId: 'chest', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Intermediate' },
    { id: '4', name: 'Incline Bench Press', muscleGroupId: 'chest', equipment: 'Barbell', sets: 4, reps: 8, difficulty: 'Intermediate' },
    { id: '5', name: 'Cable Crossover', muscleGroupId: 'chest', equipment: 'Cable', sets: 3, reps: 12, difficulty: 'Advanced' },
  ],
  legs: [
    { id: '1', name: 'Squat', muscleGroupId: 'legs', equipment: 'Barbell', sets: 4, reps: 8, difficulty: 'Intermediate' },
    { id: '2', name: 'Leg Press', muscleGroupId: 'legs', equipment: 'Machine', sets: 4, reps: 10, difficulty: 'Beginner' },
    { id: '3', name: 'Lunges', muscleGroupId: 'legs', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '4', name: 'Leg Curl', muscleGroupId: 'legs', equipment: 'Machine', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '5', name: 'Bulgarian Split Squat', muscleGroupId: 'legs', equipment: 'Dumbbell', sets: 3, reps: 10, difficulty: 'Advanced' },
  ],
  back: [
    { id: '1', name: 'Deadlift', muscleGroupId: 'back', equipment: 'Barbell', sets: 4, reps: 6, difficulty: 'Advanced' },
    { id: '2', name: 'Lat Pulldown', muscleGroupId: 'back', equipment: 'Cable', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '3', name: 'Bent Over Row', muscleGroupId: 'back', equipment: 'Barbell', sets: 4, reps: 8, difficulty: 'Intermediate' },
    { id: '4', name: 'Pull-Up', muscleGroupId: 'back', equipment: 'Bodyweight', sets: 3, reps: 8, difficulty: 'Advanced' },
    { id: '5', name: 'Seated Cable Row', muscleGroupId: 'back', equipment: 'Cable', sets: 3, reps: 12, difficulty: 'Beginner' },
  ],
  shoulders: [
    { id: '1', name: 'Overhead Press', muscleGroupId: 'shoulders', equipment: 'Barbell', sets: 4, reps: 8, difficulty: 'Intermediate' },
    { id: '2', name: 'Lateral Raise', muscleGroupId: 'shoulders', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '3', name: 'Front Raise', muscleGroupId: 'shoulders', equipment: 'Dumbbell', sets: 3, reps: 12, difficulty: 'Beginner' },
    { id: '4', name: 'Face Pull', muscleGroupId: 'shoulders', equipment: 'Cable', sets: 3, reps: 15, difficulty: 'Intermediate' },
  ],
  core: [
    { id: '1', name: 'Plank', muscleGroupId: 'core', equipment: 'Bodyweight', sets: 3, reps: 60, difficulty: 'Beginner' },
    { id: '2', name: 'Crunches', muscleGroupId: 'core', equipment: 'Bodyweight', sets: 3, reps: 20, difficulty: 'Beginner' },
    { id: '3', name: 'Russian Twist', muscleGroupId: 'core', equipment: 'Dumbbell', sets: 3, reps: 20, difficulty: 'Intermediate' },
    { id: '4', name: 'Hanging Leg Raise', muscleGroupId: 'core', equipment: 'Bodyweight', sets: 3, reps: 12, difficulty: 'Advanced' },
  ],
  fullbody: [
    { id: '1', name: 'Burpees', muscleGroupId: 'fullbody', equipment: 'Bodyweight', sets: 3, reps: 10, difficulty: 'Intermediate' },
    { id: '2', name: 'Clean and Press', muscleGroupId: 'fullbody', equipment: 'Barbell', sets: 4, reps: 6, difficulty: 'Advanced' },
    { id: '3', name: 'Kettlebell Swing', muscleGroupId: 'fullbody', equipment: 'Kettlebell', sets: 3, reps: 15, difficulty: 'Intermediate' },
    { id: '4', name: 'Mountain Climbers', muscleGroupId: 'fullbody', equipment: 'Bodyweight', sets: 3, reps: 20, difficulty: 'Beginner' },
  ],
};

export const mockUser: UserProfile = {
  id: '1',
  firstName: 'Alex',
  lastName: 'Ryan',
  initials: 'AR',
  fitnessLevel: 'Intermediate',
};
