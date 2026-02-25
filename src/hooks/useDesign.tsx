import { createContext, useContext, useReducer, useCallback, type ReactNode } from "react";

export interface DesignParams {
  character: string;
  characterImages: string[];
  scene: string;
  sceneImage: string | null;
  style: string;
  styleImage: string | null;
  text: string;
  textImage: string | null;
}

export type AppStatus = "IDLE" | "GENERATING_DESIGN" | "PROCESSING_TRANSPARENCY" | "GENERATING_MOCKUP" | "COMPLETE" | "ERROR";
export type Speed = "fast" | "quality";

interface DesignState {
  designParams: DesignParams;
  speed: Speed;
  appStatus: AppStatus;
  error: string | null;
  expandedSections: { scene: boolean; style: boolean; text: boolean };
}

type Action =
  | { type: "SET_CHARACTER"; text: string }
  | { type: "ADD_CHARACTER_IMAGE"; image: string }
  | { type: "REMOVE_CHARACTER_IMAGE"; index: number }
  | { type: "SET_SCENE"; text: string }
  | { type: "SET_SCENE_IMAGE"; image: string | null }
  | { type: "SET_STYLE"; text: string }
  | { type: "SET_STYLE_IMAGE"; image: string | null }
  | { type: "SET_TEXT"; text: string }
  | { type: "SET_TEXT_IMAGE"; image: string | null }
  | { type: "SET_SPEED"; speed: Speed }
  | { type: "TOGGLE_SECTION"; section: "scene" | "style" | "text" }
  | { type: "SET_STATUS"; status: AppStatus }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "RESET" };

const initialState: DesignState = {
  designParams: {
    character: "",
    characterImages: [],
    scene: "",
    sceneImage: null,
    style: "",
    styleImage: null,
    text: "",
    textImage: null,
  },
  speed: "quality",
  appStatus: "IDLE",
  error: null,
  expandedSections: { scene: false, style: false, text: false },
};

function reducer(state: DesignState, action: Action): DesignState {
  switch (action.type) {
    case "SET_CHARACTER":
      return { ...state, designParams: { ...state.designParams, character: action.text } };
    case "ADD_CHARACTER_IMAGE":
      return { ...state, designParams: { ...state.designParams, characterImages: [...state.designParams.characterImages, action.image] } };
    case "REMOVE_CHARACTER_IMAGE":
      return { ...state, designParams: { ...state.designParams, characterImages: state.designParams.characterImages.filter((_, i) => i !== action.index) } };
    case "SET_SCENE":
      return { ...state, designParams: { ...state.designParams, scene: action.text } };
    case "SET_SCENE_IMAGE":
      return { ...state, designParams: { ...state.designParams, sceneImage: action.image } };
    case "SET_STYLE":
      return { ...state, designParams: { ...state.designParams, style: action.text } };
    case "SET_STYLE_IMAGE":
      return { ...state, designParams: { ...state.designParams, styleImage: action.image } };
    case "SET_TEXT":
      return { ...state, designParams: { ...state.designParams, text: action.text } };
    case "SET_TEXT_IMAGE":
      return { ...state, designParams: { ...state.designParams, textImage: action.image } };
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    case "TOGGLE_SECTION":
      return { ...state, expandedSections: { ...state.expandedSections, [action.section]: !state.expandedSections[action.section] } };
    case "SET_STATUS":
      return { ...state, appStatus: action.status };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

interface DesignContextType {
  state: DesignState;
  dispatch: React.Dispatch<Action>;
}

const DesignContext = createContext<DesignContextType | null>(null);

export function DesignProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <DesignContext.Provider value={{ state, dispatch }}>{children}</DesignContext.Provider>;
}

export function useDesign() {
  const ctx = useContext(DesignContext);
  if (!ctx) throw new Error("useDesign must be used within DesignProvider");
  return ctx;
}
