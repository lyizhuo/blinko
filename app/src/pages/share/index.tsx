import { observer } from "mobx-react-lite";
import Hub from "../hub";
import { useEffect } from "react";

const Share = observer(() => {
  useEffect(() => {

  }, [])

  return <div className="flex flex-col h-[100dvh] w-full bg-secondbackground" >
    <Hub />
  </div>
});

export default Share