import { createContext, useContext } from "react";

export interface TourContextValue {
  openTour: () => void;
  closeTour: () => void;
}

export const TourContext = createContext<TourContextValue>({
  openTour: () => {},
  closeTour: () => {},
});

export function useTour() {
  return useContext(TourContext);
}
