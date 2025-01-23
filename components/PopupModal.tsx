"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface PopupModalProps {
  title: string;
  description: string;
  route: string;
  closePopup: () => void;
}

const PopupModal: React.FC<PopupModalProps> = ({
  title,
  description,
  route,
  closePopup,
}) => {
  const router = useRouter();

  const handlePlayGame = () => {
    closePopup();
    router.push(route);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 p-6 rounded-lg shadow-lg w-11/12 max-w-sm text-center">
        <h2 className="text-xl font-bold text-yellow-400">{title}</h2>
        <p className="text-gray-300 mt-2">{description}</p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            onClick={handlePlayGame}
            className="bg-yellow-400 text-gray-900 font-semibold py-2 rounded-lg hover:bg-yellow-500"
          >
            Play Game
          </button>
          <button
            onClick={closePopup}
            className="text-gray-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default PopupModal;
